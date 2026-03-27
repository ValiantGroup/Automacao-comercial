package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/valiant-group/prospector/internal/ai"
	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
)

const aiGlobalContextSettingKey = "ai_global_context"

type aiWorker struct {
	cfg         *config.Config
	queries     *db.Queries
	aiClient    *ai.Client
	client      *asynq.Client
	broadcaster func(eventType string, payload interface{})
}

func newAIWorker(cfg *config.Config, queries *db.Queries, aiClient *ai.Client, client *asynq.Client, broadcaster func(string, interface{})) *aiWorker {
	return &aiWorker{cfg: cfg, queries: queries, aiClient: aiClient, client: client, broadcaster: broadcaster}
}

// --- Analyze -----------------------------------------------------------------

type aiAnalyzePayload struct {
	CompanyID  string `json:"company_id"`
	CampaignID string `json:"campaign_id,omitempty"`
}

func (w *aiWorker) Handle(ctx context.Context, t *asynq.Task) error {
	var p aiAnalyzePayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal ai analyze payload: %w", err)
	}

	companyID, err := uuid.Parse(p.CompanyID)
	if err != nil {
		return fmt.Errorf("parse company_id: %w", err)
	}

	company, err := w.queries.GetCompany(ctx, companyID)
	if err != nil {
		return fmt.Errorf("get company: %w", err)
	}

	intel, err := w.queries.GetIntelligence(ctx, companyID)
	if err != nil {
		slog.Warn("Intelligence not found for analysis, proceeding with minimal data", "company_id", companyID)
		intel.CompanyID = companyID
	}

	stakeholders, _ := w.queries.ListStakeholdersByCompany(ctx, companyID)

	// Deterministic, evidence-based analysis to avoid unsupported claims.
	result := buildDeterministicAnalysis(company, intel, stakeholders)
	slog.Info("Deterministic analysis complete",
		"company_id", companyID,
		"name", company.Name,
		"fit_score", result.FitScore,
		"pain_points", len(result.PainPoints))

	painJSON, err := json.Marshal(result.PainPoints)
	if err != nil {
		return fmt.Errorf("marshal pain points: %w", err)
	}
	techStackJSON, err := json.Marshal(result.TechStack)
	if err != nil {
		return fmt.Errorf("marshal tech stack result: %w", err)
	}
	fitScore := int32(result.FitScore)

	upsertParams := db.UpsertIntelligenceParams{
		CompanyID:            companyID,
		Summary:              &result.Summary,
		PainPoints:           painJSON,
		FitScore:             &fitScore,
		FitJustification:     &result.FitJustification,
		TechStack:            techStackJSON,
		ReputationScore:      intel.ReputationScore,
		ReputationSummary:    intel.ReputationSummary,
		OpenJobs:             intel.OpenJobs,
		LinkedInFollowers:    intel.LinkedInFollowers,
		LinkedInAbout:        intel.LinkedInAbout,
		WebsiteDescription:   intel.WebsiteDescription,
		PersonaPriority:      &result.PersonaPriority,
		PersonaJustification: &result.PersonaJustification,
		RawWebData:           intel.RawWebData,
		RawLinkedInData:      intel.RawLinkedInData,
	}

	if _, err := w.queries.UpsertIntelligence(ctx, upsertParams); err != nil {
		return fmt.Errorf("upsert intelligence: %w", err)
	}

	if err := w.queries.UpdateCompanyAIScore(ctx, companyID, int32(result.FitScore)); err != nil {
		slog.Error("Update AI score failed", "company_id", companyID, "error", err)
	}

	if _, err := w.queries.UpdateCompanyStage(ctx, companyID, "analyzed"); err != nil {
		slog.Error("Update stage failed", "company_id", companyID, "error", err)
	}

	if strings.TrimSpace(w.cfg.OpenAIEmbedModel) != "" {
		// Generate embedding with independent context to avoid task cancellation races.
		go func(c db.Company, id uuid.UUID) {
			embedCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			text := c.Name
			if c.Address != nil {
				text += " " + *c.Address
			}

			embedding, err := w.aiClient.Embed(embedCtx, text)
			if err != nil {
				slog.Warn("Embedding generation failed", "company_id", id, "error", err)
				return
			}
			if err := w.queries.UpdateCompanyEmbedding(embedCtx, id, embedding); err != nil {
				slog.Warn("Save embedding failed", "company_id", id, "error", err)
			}
		}(company, companyID)
	}

	w.broadcaster("ai_analyzed", map[string]interface{}{
		"company_id": companyID,
		"name":       company.Name,
		"fit_score":  result.FitScore,
	})

	generatePayload, err := json.Marshal(map[string]string{
		"company_id":  companyID.String(),
		"campaign_id": p.CampaignID,
	})
	if err != nil {
		return fmt.Errorf("marshal generate payload: %w", err)
	}

	if _, err := w.client.Enqueue(
		asynq.NewTask(TaskAIGenerate, generatePayload),
		asynq.MaxRetry(3),
		asynq.Queue("ai"),
	); err != nil {
		slog.Error("Enqueue AI generate failed", "company_id", companyID, "error", err)
	}

	return nil
}

// --- Generate ----------------------------------------------------------------

type aiGeneratePayload struct {
	CompanyID  string `json:"company_id"`
	CampaignID string `json:"campaign_id"`
}

func (w *aiWorker) HandleGenerate(ctx context.Context, t *asynq.Task) error {
	var p aiGeneratePayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal generate payload: %w", err)
	}

	companyID, err := uuid.Parse(p.CompanyID)
	if err != nil {
		return fmt.Errorf("parse company_id: %w", err)
	}

	campaignID, err := uuid.Parse(p.CampaignID)
	if err != nil {
		campaignID = uuid.Nil
	}

	company, err := w.queries.GetCompany(ctx, companyID)
	if err != nil {
		return fmt.Errorf("get company: %w", err)
	}

	intel, err := w.queries.GetIntelligence(ctx, companyID)
	if err != nil {
		return fmt.Errorf("get intelligence: %w", err)
	}
	compactIntel := buildCompactIntelligenceForMessage(intel)

	if !isEvidenceSufficientForMessage(compactIntel) {
		slog.Warn("Skipping message generation: insufficient evidence", "company_id", companyID)
		return nil
	}

	stakeholder, err := w.queries.GetPriorityStakeholder(ctx, companyID)
	if err != nil {
		slog.Warn("No stakeholder found, using generic contact", "company_id", companyID)
	}

	stakeholderName := "Responsavel"
	stakeholderRole := "Decisor"
	if stakeholder.Name != "" {
		stakeholderName = stakeholder.Name
	}
	if stakeholder.NormalizedRole != nil {
		stakeholderRole = *stakeholder.NormalizedRole
	}

	contextText := w.resolveGlobalAIContext(ctx)

	intelJSON, err := json.Marshal(compactIntel)
	if err != nil {
		return fmt.Errorf("marshal compact intelligence: %w", err)
	}

	msgParams := ai.MessageParams{
		StakeholderName:  stakeholderName,
		StakeholderRole:  stakeholderRole,
		CompanyName:      company.Name,
		IntelligenceJSON: string(intelJSON),
		CampaignContext:  contextText,
	}

	slog.Info("Generating outreach messages", "company_id", companyID, "stakeholder", stakeholderName)

	fallbackResult := buildDeterministicMessageFallback(company.Name, stakeholderName, stakeholderRole, compactIntel.PrimaryPainPoint)

	raw, err := w.aiClient.Complete(ctx, ai.MessageSystemPrompt, ai.BuildMessagePrompt(msgParams))
	if err != nil {
		slog.Warn("AI message generation failed, using deterministic message", "company_id", companyID, "error", err)
		return w.persistGeneratedMessages(ctx, companyID, company.Name, campaignID, stakeholder, fallbackResult)
	}

	aiResult, err := ai.ParseMessages(raw)
	if err != nil {
		slog.Warn("AI message parse failed, using deterministic message", "company_id", companyID, "error", err)
		return w.persistGeneratedMessages(ctx, companyID, company.Name, campaignID, stakeholder, fallbackResult)
	}

	if !isGroundedMessageResult(aiResult, company.Name, compactIntel) {
		slog.Warn("AI message failed grounding validation, using deterministic message", "company_id", companyID)
		return w.persistGeneratedMessages(ctx, companyID, company.Name, campaignID, stakeholder, fallbackResult)
	}

	return w.persistGeneratedMessages(ctx, companyID, company.Name, campaignID, stakeholder, aiResult)
}

func (w *aiWorker) persistGeneratedMessages(ctx context.Context, companyID uuid.UUID, companyName string, campaignID uuid.UUID, stakeholder db.Stakeholder, result ai.MessageResult) error {
	if strings.TrimSpace(result.WhatsApp) == "" || strings.TrimSpace(result.EmailBody) == "" || strings.TrimSpace(result.EmailSubject) == "" {
		slog.Warn("Skipping message save: empty message content", "company_id", companyID)
		return nil
	}

	var stakeholderIDPtr *uuid.UUID
	if stakeholder.ID != uuid.Nil {
		id := stakeholder.ID
		stakeholderIDPtr = &id
	}

	if campaignID == uuid.Nil {
		slog.Warn("No campaign ID, skipping message save", "company_id", companyID)
		return nil
	}

	if _, err := w.queries.CreateOutreachMessage(ctx, db.CreateOutreachMessageParams{
		CompanyID:     companyID,
		StakeholderID: stakeholderIDPtr,
		CampaignID:    campaignID,
		Channel:       "whatsapp",
		Content:       result.WhatsApp,
	}); err != nil {
		slog.Error("Save WhatsApp message failed", "company_id", companyID, "error", err)
	}

	if _, err := w.queries.CreateOutreachMessage(ctx, db.CreateOutreachMessageParams{
		CompanyID:     companyID,
		StakeholderID: stakeholderIDPtr,
		CampaignID:    campaignID,
		Channel:       "email",
		Content:       result.EmailBody,
		Subject:       &result.EmailSubject,
	}); err != nil {
		slog.Error("Save email message failed", "company_id", companyID, "error", err)
	}

	w.broadcaster("message_generated", map[string]interface{}{
		"company_id":   companyID,
		"company_name": companyName,
	})

	slog.Info("Messages generated and saved as pending_review", "company_id", companyID)
	return nil
}

func (w *aiWorker) resolveGlobalAIContext(ctx context.Context) string {
	setting, err := w.queries.GetSystemSetting(ctx, aiGlobalContextSettingKey)
	if err == nil {
		v := strings.TrimSpace(setting.ValueText)
		if v != "" {
			return v
		}
	}
	return strings.TrimSpace(w.cfg.AIGlobalContext)
}

type compactIntelligenceForMessage struct {
	Summary          *string  `json:"summary,omitempty"`
	PainPoints       []string `json:"pain_points,omitempty"`
	FitScore         *int32   `json:"fit_score,omitempty"`
	FitJustification *string  `json:"fit_justification,omitempty"`
	TechStack        []string `json:"tech_stack,omitempty"`
	Reputation       *string  `json:"reputation_summary,omitempty"`
	Website          *string  `json:"website_description,omitempty"`
	LinkedIn         *string  `json:"linkedin_about,omitempty"`

	PrimaryPainPoint string `json:"-"`
}

func buildCompactIntelligenceForMessage(intel db.CompanyIntelligence) compactIntelligenceForMessage {
	pains := parseJSONStringArray(intel.PainPoints)
	tech := parseJSONStringArray(intel.TechStack)

	return compactIntelligenceForMessage{
		Summary:          intel.Summary,
		PainPoints:       pains,
		FitScore:         intel.FitScore,
		FitJustification: intel.FitJustification,
		TechStack:        tech,
		Reputation:       intel.ReputationSummary,
		Website:          intel.WebsiteDescription,
		LinkedIn:         intel.LinkedInAbout,
		PrimaryPainPoint: selectPrimaryPainPoint(pains),
	}
}

func selectPrimaryPainPoint(pains []string) string {
	for _, pain := range pains {
		p := strings.TrimSpace(pain)
		if p == "" {
			continue
		}
		lower := strings.ToLower(p)
		if strings.Contains(lower, "evidencias insuficientes") {
			continue
		}
		return p
	}
	return ""
}

func isEvidenceSufficientForMessage(intel compactIntelligenceForMessage) bool {
	return strings.TrimSpace(intel.PrimaryPainPoint) != ""
}

func buildDeterministicMessageFallback(companyName, stakeholderName, stakeholderRole, primaryPain string) ai.MessageResult {
	pain := strings.TrimSpace(primaryPain)
	if pain == "" {
		return ai.MessageResult{}
	}

	whatsApp := fmt.Sprintf(
		"%s, tudo bem? No diagnostico da %s, identificamos: %s. A Valiant atua na digitalizacao e automacao para reduzir esse impacto. Podemos falar 15 min?",
		stakeholderName, companyName, pain,
	)
	if len([]rune(whatsApp)) > 300 {
		runes := []rune(whatsApp)
		whatsApp = string(runes[:297]) + "..."
	}

	emailSubject := fmt.Sprintf("%s: acao sobre %s", companyName, pain)
	if len([]rune(emailSubject)) > 60 {
		runes := []rune(emailSubject)
		emailSubject = string(runes[:57]) + "..."
	}

	emailBody := fmt.Sprintf(
		"Ola %s,\n\nNo diagnostico da %s, encontramos um ponto objetivo: %s.\n\nA Valiant implementa automacao e digitalizacao de processos para reduzir retrabalho, tempo de resposta e perda operacional.\n\nSe fizer sentido para sua area (%s), envio um plano inicial de execucao.\n\nAtenciosamente,\nValiant Group",
		stakeholderName,
		companyName,
		pain,
		stakeholderRole,
	)

	return ai.MessageResult{
		WhatsApp:     whatsApp,
		EmailSubject: emailSubject,
		EmailBody:    emailBody,
	}
}

func isGroundedMessageResult(result ai.MessageResult, companyName string, intel compactIntelligenceForMessage) bool {
	if strings.TrimSpace(result.WhatsApp) == "" || strings.TrimSpace(result.EmailSubject) == "" || strings.TrimSpace(result.EmailBody) == "" {
		return false
	}
	if len([]rune(result.WhatsApp)) > 300 || len([]rune(result.EmailSubject)) > 60 {
		return false
	}
	if len(strings.Fields(result.EmailBody)) > 170 {
		return false
	}

	lowerWhats := strings.ToLower(result.WhatsApp)
	lowerEmail := strings.ToLower(result.EmailBody)
	lowerCompany := strings.ToLower(strings.TrimSpace(companyName))
	if lowerCompany != "" && !strings.Contains(lowerWhats, lowerCompany) && !strings.Contains(lowerEmail, lowerCompany) {
		return false
	}

	primaryPain := strings.ToLower(strings.TrimSpace(intel.PrimaryPainPoint))
	if primaryPain == "" {
		return false
	}
	if !strings.Contains(lowerWhats, primaryPain) && !strings.Contains(lowerEmail, primaryPain) {
		return false
	}

	hasWebsiteEvidence := intel.Website != nil && strings.TrimSpace(*intel.Website) != ""
	if !hasWebsiteEvidence {
		banned := []string{"analisei seu site", "no site de voces", "vi no site", "observando o site"}
		for _, phrase := range banned {
			if strings.Contains(lowerWhats, phrase) || strings.Contains(lowerEmail, phrase) {
				return false
			}
		}
	}

	return true
}

