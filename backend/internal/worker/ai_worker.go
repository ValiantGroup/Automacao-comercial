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
const defaultStakeholderAIScoreThreshold int32 = 60

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
	if enrichedIntel, err := w.enrichWebsiteNarrativeWithAI(ctx, company, intel); err != nil {
		slog.Warn("AI website narrative enrichment failed", "company_id", companyID, "error", err)
	} else {
		intel = enrichedIntel
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

	campaignID := uuid.Nil
	if parsedCampaignID, parseErr := uuid.Parse(p.CampaignID); parseErr == nil {
		campaignID = parsedCampaignID
	}
	minStakeholderAIScore := defaultStakeholderAIScoreThreshold
	if campaignID != uuid.Nil {
		campaign, campaignErr := w.queries.GetCampaign(ctx, campaignID)
		if campaignErr != nil {
			slog.Warn("Get campaign failed while resolving stakeholder threshold", "campaign_id", campaignID, "error", campaignErr)
		} else {
			minStakeholderAIScore = campaign.MinAIScoreStakeholders
		}
	}

	w.broadcaster("ai_analyzed", map[string]interface{}{
		"company_id":   companyID,
		"company_name": company.Name,
		"campaign_id":  campaignID,
		"fit_score":    result.FitScore,
	})

	if int32(result.FitScore) >= minStakeholderAIScore && campaignID != uuid.Nil {
		linkedinPayload, err := json.Marshal(map[string]string{
			"company_id":  companyID.String(),
			"campaign_id": campaignID.String(),
		})
		if err != nil {
			return fmt.Errorf("marshal linkedin payload: %w", err)
		}
		if _, err := w.client.Enqueue(
			asynq.NewTask(TaskEnrichLinkedIn, linkedinPayload),
			asynq.MaxRetry(3),
			asynq.Queue("enrichment"),
			asynq.Unique(30*time.Second),
		); err != nil {
			slog.Error("Enqueue linkedin enrichment failed", "company_id", companyID, "campaign_id", campaignID, "error", err)
			return w.enqueueGenerateTask(companyID, campaignID.String())
		}
		slog.Info("Stakeholder search queued after AI threshold", "company_id", companyID, "campaign_id", campaignID, "fit_score", result.FitScore, "min_ai_score", minStakeholderAIScore)
		return nil
	}

	if int32(result.FitScore) < minStakeholderAIScore {
		slog.Info("Skipping stakeholder search due AI threshold", "company_id", companyID, "fit_score", result.FitScore, "min_ai_score", minStakeholderAIScore)
	}

	return w.enqueueGenerateTask(companyID, p.CampaignID)
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

	stakeholderName := "Responsável"
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
		"campaign_id":  campaignID,
	})

	slog.Info("Messages generated and saved as pending_review", "company_id", companyID)
	return nil
}

func (w *aiWorker) enqueueGenerateTask(companyID uuid.UUID, campaignID string) error {
	generatePayload, err := json.Marshal(map[string]string{
		"company_id":  companyID.String(),
		"campaign_id": campaignID,
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
	Summary                *string  `json:"summary,omitempty"`
	PainPoints             []string `json:"pain_points,omitempty"`
	FitScore               *int32   `json:"fit_score,omitempty"`
	FitJustification       *string  `json:"fit_justification,omitempty"`
	TechStack              []string `json:"tech_stack,omitempty"`
	Reputation             *string  `json:"reputation_summary,omitempty"`
	Website                *string  `json:"website_description,omitempty"`
	LinkedIn               *string  `json:"linkedin_about,omitempty"`
	WebsiteIssues          []string `json:"website_issues,omitempty"`
	WebsiteContacts        []string `json:"website_contacts,omitempty"`
	WebsiteBusinessSignals []string `json:"website_business_signals,omitempty"`
	LocationHints          []string `json:"location_hints,omitempty"`
	ReclameAquiTopics      []string `json:"reclame_aqui_topics,omitempty"`
	ReclameAquiComplaints  []string `json:"reclame_aqui_recent_complaints,omitempty"`

	PrimaryPainPoint string `json:"-"`
}

func buildCompactIntelligenceForMessage(intel db.CompanyIntelligence) compactIntelligenceForMessage {
	pains := parseJSONStringArray(intel.PainPoints)
	tech := parseJSONStringArray(intel.TechStack)
	rawWeb := parseRawWebPayload(intel.RawWebData)
	websiteIssues := make([]string, 0, len(rawWeb.Website.Issues)+len(rawWeb.Derived.SiteIssues))
	websiteIssues = append(websiteIssues, rawWeb.Derived.SiteIssues...)
	for _, issue := range rawWeb.Website.Issues {
		if msg := strings.TrimSpace(issue.Message); msg != "" {
			websiteIssues = append(websiteIssues, msg)
		}
	}
	websiteContacts := dedupeNonEmptyStrings(append(
		append(rawWeb.Website.ContactSignals.Emails, rawWeb.Website.ContactSignals.Phones...),
		rawWeb.Website.ContactSignals.WhatsAppNumbers...,
	))
	websiteBusiness := dedupeNonEmptyStrings(append(rawWeb.Derived.WhatCompanyDoes, rawWeb.Website.BusinessSignals.WhatCompanyDoes...))
	locationHints := dedupeNonEmptyStrings(append(
		append(rawWeb.Derived.LocationHints, rawWeb.Website.BusinessSignals.LocationHints...),
		rawWeb.Website.ContactSignals.Addresses...,
	))
	reclameTopics := dedupeNonEmptyStrings(rawWeb.ReclameAqui.ComplaintTopics)
	recentComplaints := dedupeNonEmptyStrings(rawWeb.ReclameAqui.RecentComplaints)

	return compactIntelligenceForMessage{
		Summary:                intel.Summary,
		PainPoints:             pains,
		FitScore:               intel.FitScore,
		FitJustification:       intel.FitJustification,
		TechStack:              tech,
		Reputation:             intel.ReputationSummary,
		Website:                intel.WebsiteDescription,
		LinkedIn:               intel.LinkedInAbout,
		WebsiteIssues:          websiteIssues,
		WebsiteContacts:        websiteContacts,
		WebsiteBusinessSignals: websiteBusiness,
		LocationHints:          locationHints,
		ReclameAquiTopics:      reclameTopics,
		ReclameAquiComplaints:  recentComplaints,
		PrimaryPainPoint:       selectPrimaryPainPoint(append(pains, websiteIssues...)),
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
		"%s, tudo bem? Estamos entrando em contato com a %s porque vimos que %s. Nós da Valiant Group temos solucões para isso. Podemos falar por 15 min?",
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
		"Ola %s,\n\nEstamos entrando em contato com a %s, porque vimos que %s.\n\nNós da Valiant Group temos solucões para isso e outras oportunidades que podem interessar.\n\nSe fizer sentido para sua area (%s), Podemos marcar um horário para conversarmos sobre?.\n\nAtenciosamente,\nValiant Group",
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

const aiWebsiteNarrativeSystemPrompt = `Voce e um analista de inteligencia comercial no Brasil.
Seu trabalho e transformar evidencias brutas de website em uma descricao coesa sobre a empresa.
Use apenas as evidencias fornecidas. Nao invente fatos.
Ignore textos de erro (404), menus repetidos, cookies, placeholders e links tecnicos.
Retorne somente JSON valido.`

type aiWebsiteNarrativeResult struct {
	AboutCompany   string   `json:"about_company"`
	WhatCompany    []string `json:"what_company_does"`
	CoreOffers     []string `json:"core_offers"`
	LocationHints  []string `json:"location_hints"`
	PainHypotheses []string `json:"pain_hypotheses"`
	Confidence     int      `json:"confidence"`
}

func (w *aiWorker) enrichWebsiteNarrativeWithAI(ctx context.Context, company db.Company, intel db.CompanyIntelligence) (db.CompanyIntelligence, error) {
	if w.aiClient == nil || strings.TrimSpace(w.cfg.OpenAIAPIKey) == "" {
		return intel, nil
	}

	rawWeb := parseRawWebPayload(intel.RawWebData)
	evidence := buildWebsiteEvidenceForAI(rawWeb)
	if len(evidence) == 0 {
		return intel, nil
	}

	evidenceJSON, err := json.Marshal(evidence)
	if err != nil {
		return intel, fmt.Errorf("marshal website evidence: %w", err)
	}

	prompt := fmt.Sprintf(`Gere um JSON com a estrutura exata abaixo:
{
  "about_company": "string (2-4 frases, coesa, explicando o que a empresa faz, para quem e contexto operacional)",
  "what_company_does": ["string curta"],
  "core_offers": ["string curta"],
  "location_hints": ["string"],
  "pain_hypotheses": ["string objetiva, baseada apenas em evidencia"],
  "confidence": 0
}

Regras:
- Nao citar informacao sem evidencia direta.
- Nao repetir menu de navegacao ou texto de erro.
- Se evidencia for fraca, reduza confidence.
- about_company deve ser natural e conectada, sem frases soltas.
- confidence deve ser inteiro entre 0 e 100.

Empresa: %s
Nicho: %s
Evidencias brutas (JSON):
%s`,
		company.Name,
		strings.TrimSpace(ptrToString(company.Niche)),
		string(evidenceJSON),
	)

	aiCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	raw, err := w.aiClient.Complete(aiCtx, aiWebsiteNarrativeSystemPrompt, prompt)
	if err != nil {
		return intel, fmt.Errorf("ai completion website narrative: %w", err)
	}

	result, err := parseAIWebsiteNarrativeResult(raw)
	if err != nil {
		return intel, fmt.Errorf("parse website narrative: %w", err)
	}

	if isLowQualityWebsiteNarrative(result.AboutCompany) {
		return intel, nil
	}

	mergedRaw, err := mergeAIWebsiteNarrativeIntoRaw(intel.RawWebData, result)
	if err != nil {
		return intel, fmt.Errorf("merge website narrative in raw data: %w", err)
	}

	intel.RawWebData = mergedRaw
	intel.WebsiteDescription = strIfNotEmpty(result.AboutCompany)
	return intel, nil
}

func buildWebsiteEvidenceForAI(rawWeb rawWebPayload) map[string]interface{} {
	website := rawWeb.Website
	contentSignals := dedupeNonEmptyStrings(append(
		append(
			append(website.TextSamples, website.Headings.H1...),
			website.Headings.H2...,
		),
		website.Headings.H3...,
	))
	contentSignals = limitStringSlice(contentSignals, 48)

	businessSignals := dedupeNonEmptyStrings(append(
		append(
			append(
				website.BusinessSignals.WhatCompanyDoes,
				website.BusinessSignals.ValuePropositions...,
			),
			website.BusinessSignals.TargetMarketHints...,
		),
		website.BusinessSignals.CTAPhrases...,
	))
	businessSignals = limitStringSlice(businessSignals, 24)

	issues := make([]string, 0, len(website.Issues))
	for _, issue := range website.Issues {
		msg := strings.TrimSpace(issue.Message)
		if msg == "" {
			continue
		}
		if sev := strings.TrimSpace(issue.Severity); sev != "" {
			msg = fmt.Sprintf("[%s] %s", strings.ToUpper(sev), msg)
		}
		issues = append(issues, msg)
	}
	issues = limitStringSlice(dedupeNonEmptyStrings(issues), 16)

	pageSummaries := make([]map[string]string, 0, len(website.PageSummaries))
	for _, page := range website.PageSummaries {
		title := strings.TrimSpace(page.Title)
		desc := strings.TrimSpace(page.Description)
		if title == "" && desc == "" {
			continue
		}
		pageSummaries = append(pageSummaries, map[string]string{
			"url":         strings.TrimSpace(page.URL),
			"title":       title,
			"description": desc,
		})
		if len(pageSummaries) >= 14 {
			break
		}
	}

	contacts := map[string]interface{}{
		"emails":        limitStringSlice(website.ContactSignals.Emails, 12),
		"phones":        limitStringSlice(website.ContactSignals.Phones, 12),
		"whatsapp":      limitStringSlice(website.ContactSignals.WhatsAppNumbers, 12),
		"addresses":     limitStringSlice(website.ContactSignals.Addresses, 10),
		"contact_pages": limitStringSlice(website.ContactSignals.ContactPages, 12),
	}

	reputation := map[string]interface{}{
		"topics":            limitStringSlice(rawWeb.ReclameAqui.ComplaintTopics, 8),
		"recent_complaints": limitStringSlice(rawWeb.ReclameAqui.RecentComplaints, 8),
	}

	evidence := map[string]interface{}{
		"website_title":       strings.TrimSpace(website.Title),
		"website_description": strings.TrimSpace(website.Description),
		"text_samples":        contentSignals,
		"business_signals":    businessSignals,
		"location_hints": limitStringSlice(
			dedupeNonEmptyStrings(append(
				append(rawWeb.Derived.LocationHints, website.BusinessSignals.LocationHints...),
				website.ContactSignals.Addresses...,
			)),
			12,
		),
		"issues":         issues,
		"contacts":       contacts,
		"pages_scanned":  limitStringSlice(website.PagesScanned, 20),
		"page_summaries": pageSummaries,
		"reputation":     reputation,
	}

	hasContent := strings.TrimSpace(website.Title) != "" ||
		strings.TrimSpace(website.Description) != "" ||
		len(contentSignals) > 0 ||
		len(businessSignals) > 0 ||
		len(pageSummaries) > 0
	if !hasContent {
		return map[string]interface{}{}
	}
	return evidence
}

func parseAIWebsiteNarrativeResult(raw string) (aiWebsiteNarrativeResult, error) {
	var result aiWebsiteNarrativeResult
	if err := unmarshalWrappedJSONObject(raw, &result); err != nil {
		return result, err
	}

	result.AboutCompany = strings.TrimSpace(result.AboutCompany)
	result.WhatCompany = limitStringSlice(dedupeNonEmptyStrings(result.WhatCompany), 8)
	result.CoreOffers = limitStringSlice(dedupeNonEmptyStrings(result.CoreOffers), 10)
	result.LocationHints = limitStringSlice(dedupeNonEmptyStrings(result.LocationHints), 10)
	result.PainHypotheses = limitStringSlice(dedupeNonEmptyStrings(result.PainHypotheses), 8)
	if result.Confidence < 0 {
		result.Confidence = 0
	}
	if result.Confidence > 100 {
		result.Confidence = 100
	}
	return result, nil
}

func isLowQualityWebsiteNarrative(about string) bool {
	about = strings.TrimSpace(about)
	if about == "" {
		return true
	}
	if len(strings.Fields(about)) < 12 {
		return true
	}
	lower := strings.ToLower(about)
	blocked := []string{
		"404",
		"page not found",
		"pagina nao encontrada",
		"oops",
		"clique aqui",
	}
	for _, b := range blocked {
		if strings.Contains(lower, b) {
			return true
		}
	}
	return false
}

func mergeAIWebsiteNarrativeIntoRaw(raw json.RawMessage, result aiWebsiteNarrativeResult) (json.RawMessage, error) {
	payload := map[string]interface{}{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			return nil, err
		}
	}

	derived, _ := payload["derived"].(map[string]interface{})
	if derived == nil {
		derived = map[string]interface{}{}
	}

	existingWhat := toStringSliceAny(derived["what_company_does"])
	derived["what_company_does"] = limitStringSlice(
		dedupeNonEmptyStrings(append(result.WhatCompany, existingWhat...)),
		14,
	)

	existingLocations := toStringSliceAny(derived["location_hints"])
	derived["location_hints"] = limitStringSlice(
		dedupeNonEmptyStrings(append(result.LocationHints, existingLocations...)),
		14,
	)

	existingPains := toStringSliceAny(derived["pain_signals"])
	derived["pain_signals"] = limitStringSlice(
		dedupeNonEmptyStrings(append(existingPains, result.PainHypotheses...)),
		20,
	)

	derived["ai_about_company"] = result.AboutCompany
	derived["ai_what_company_does"] = result.WhatCompany
	derived["ai_core_offers"] = result.CoreOffers
	derived["ai_location_hints"] = result.LocationHints
	derived["ai_pain_hypotheses"] = result.PainHypotheses
	derived["ai_confidence"] = result.Confidence

	payload["derived"] = derived
	if strings.TrimSpace(result.AboutCompany) != "" {
		payload["website_description"] = result.AboutCompany
	}

	merged, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return merged, nil
}

func limitStringSlice(items []string, maxItems int) []string {
	items = dedupeNonEmptyStrings(items)
	if maxItems <= 0 || len(items) <= maxItems {
		return items
	}
	return items[:maxItems]
}

func toStringSliceAny(value interface{}) []string {
	if value == nil {
		return nil
	}
	switch v := value.(type) {
	case []string:
		return dedupeNonEmptyStrings(v)
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return dedupeNonEmptyStrings(out)
	default:
		return nil
	}
}

func unmarshalWrappedJSONObject(raw string, out interface{}) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fmt.Errorf("empty json response")
	}
	if err := json.Unmarshal([]byte(raw), out); err == nil {
		return nil
	}
	obj := extractFirstJSONObjectLocal(raw)
	if obj == "" {
		return fmt.Errorf("no json object found")
	}
	return json.Unmarshal([]byte(obj), out)
}

func extractFirstJSONObjectLocal(s string) string {
	start := strings.IndexByte(s, '{')
	if start < 0 {
		return ""
	}

	inString := false
	escaped := false
	depth := 0
	for i := start; i < len(s); i++ {
		ch := s[i]
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == '"' {
				inString = false
			}
			continue
		}

		switch ch {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return s[start : i+1]
			}
		}
	}
	return ""
}
