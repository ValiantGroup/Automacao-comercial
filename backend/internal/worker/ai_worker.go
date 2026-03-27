package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/valiant-group/prospector/internal/ai"
	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
)

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

// ─── Analyze ──────────────────────────────────────────────────────────────────

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
		// Upsert empty intelligence so the AI still runs
		intel.CompanyID = companyID
	}

	stakeholders, _ := w.queries.ListStakeholdersByCompany(ctx, companyID)
	stakeholderDesc := "Nenhum stakeholder encontrado"
	if len(stakeholders) > 0 {
		names := make([]string, 0, len(stakeholders))
		for _, s := range stakeholders {
			role := "Cargo desconhecido"
			if s.NormalizedRole != nil {
				role = *s.NormalizedRole
			}
			names = append(names, fmt.Sprintf("%s (%s)", s.Name, role))
		}
		b, marshalErr := json.Marshal(names)
		if marshalErr == nil {
			stakeholderDesc = string(b)
		}
	}

	techJSON, err := json.Marshal(intel.TechStack)
	if err != nil {
		return fmt.Errorf("marshal tech stack: %w", err)
	}
	openJobsJSON, err := json.Marshal(intel.OpenJobs)
	if err != nil {
		return fmt.Errorf("marshal open jobs: %w", err)
	}
	techStr := string(techJSON)
	openJobsStr := string(openJobsJSON)

	repScoreStr := "N/A"
	if intel.ReputationScore != nil {
		repScoreStr = fmt.Sprintf("%.1f", *intel.ReputationScore)
	}

	campaignContext := "Software house focada em digitalização e automação de processos para empresas B2B"

	params := ai.AnalysisParams{
		CampaignContext:    campaignContext,
		CompanyName:        company.Name,
		Niche:              ptrStr(company.Niche),
		WebsiteDescription: intel.WebsiteDescription,
		LinkedInAbout:      intel.LinkedInAbout,
		TechStack:          &techStr,
		OpenJobs:           &openJobsStr,
		ReputationScore:    &repScoreStr,
		ReputationSummary:  intel.ReputationSummary,
		Stakeholders:       &stakeholderDesc,
	}

	slog.Info("Running AI analysis", "company_id", companyID, "name", company.Name)

	raw, err := w.aiClient.Complete(ctx, ai.AnalysisSystemPrompt, ai.BuildAnalysisPrompt(params))
	if err != nil {
		return fmt.Errorf("AI complete: %w", err)
	}

	result, err := ai.ParseAnalysis(raw)
	if err != nil {
		return fmt.Errorf("parse analysis: %w", err)
	}

	// Build updated intelligence
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

	// Update company AI score
	if err := w.queries.UpdateCompanyAIScore(ctx, companyID, int32(result.FitScore)); err != nil {
		slog.Error("Update AI score failed", "company_id", companyID, "error", err)
	}

	// Advance pipeline stage
	if _, err := w.queries.UpdateCompanyStage(ctx, companyID, "analyzed"); err != nil {
		slog.Error("Update stage failed", "company_id", companyID, "error", err)
	}

	// Generate embedding for dedup
	go func() {
		embedCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()
		text := company.Name
		if company.Address != nil {
			text += " " + *company.Address
		}
		embedding, err := w.aiClient.Embed(embedCtx, text)
		if err != nil {
			slog.Warn("Embedding generation failed", "company_id", companyID, "error", err)
			return
		}
		if err := w.queries.UpdateCompanyEmbedding(embedCtx, companyID, embedding); err != nil {
			slog.Warn("Save embedding failed", "company_id", companyID, "error", err)
		}
	}()

	// Emit websocket event
	w.broadcaster("ai_analyzed", map[string]interface{}{
		"company_id": companyID,
		"name":       company.Name,
		"fit_score":  result.FitScore,
	})

	slog.Info("AI analysis complete", "company_id", companyID, "fit_score", result.FitScore)

	// Enqueue message generation
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

// ─── Generate ─────────────────────────────────────────────────────────────────

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
		// No campaign linked — generate anyway with a default campaign structure
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

	// Get priority stakeholder
	stakeholder, err := w.queries.GetPriorityStakeholder(ctx, companyID)
	if err != nil {
		slog.Warn("No stakeholder found, using generic contact", "company_id", companyID)
	}

	stakeholderName := "Responsável"
	stakeholderRole := "Decisor"
	if stakeholder.Name != "" {
		stakeholderName = stakeholder.Name
	}
	if stakeholder.NormalizedRole != nil {
		stakeholderRole = *stakeholder.NormalizedRole
	}

	// Get campaign context
	campaignContext := "Valiant Group: parceiro estratégico em digitalização e automação de processos"
	if campaignID != uuid.Nil {
		campaign, err := w.queries.GetCampaign(ctx, campaignID)
		if err == nil {
			campaignContext = campaign.AIPromptContext
		}
	}

	intelJSON, err := json.Marshal(intel)
	if err != nil {
		return fmt.Errorf("marshal intelligence: %w", err)
	}

	msgParams := ai.MessageParams{
		StakeholderName:  stakeholderName,
		StakeholderRole:  stakeholderRole,
		CompanyName:      company.Name,
		IntelligenceJSON: string(intelJSON),
		CampaignContext:  campaignContext,
	}

	slog.Info("Generating outreach messages", "company_id", companyID, "stakeholder", stakeholderName)

	raw, err := w.aiClient.Complete(ctx, ai.MessageSystemPrompt, ai.BuildMessagePrompt(msgParams))
	if err != nil {
		return fmt.Errorf("AI generate messages: %w", err)
	}

	result, err := ai.ParseMessages(raw)
	if err != nil {
		return fmt.Errorf("parse messages: %w", err)
	}

	var stakeholderIDPtr *uuid.UUID
	if stakeholder.ID != uuid.Nil {
		id := stakeholder.ID
		stakeholderIDPtr = &id
	}

	// Save WhatsApp message
	msgCampaignID := campaignID
	if msgCampaignID == uuid.Nil {
		// Need a valid campaign ID — skip if none
		slog.Warn("No campaign ID, skipping message save", "company_id", companyID)
		return nil
	}

	if _, err := w.queries.CreateOutreachMessage(ctx, db.CreateOutreachMessageParams{
		CompanyID:     companyID,
		StakeholderID: stakeholderIDPtr,
		CampaignID:    msgCampaignID,
		Channel:       "whatsapp",
		Content:       result.WhatsApp,
	}); err != nil {
		slog.Error("Save WhatsApp message failed", "company_id", companyID, "error", err)
	}

	// Save Email message
	if _, err := w.queries.CreateOutreachMessage(ctx, db.CreateOutreachMessageParams{
		CompanyID:     companyID,
		StakeholderID: stakeholderIDPtr,
		CampaignID:    msgCampaignID,
		Channel:       "email",
		Content:       result.EmailBody,
		Subject:       &result.EmailSubject,
	}); err != nil {
		slog.Error("Save email message failed", "company_id", companyID, "error", err)
	}

	// Emit WebSocket event
	w.broadcaster("message_generated", map[string]interface{}{
		"company_id":   companyID,
		"company_name": company.Name,
	})

	slog.Info("Messages generated and saved as pending_review", "company_id", companyID)
	return nil
}

func ptrStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
