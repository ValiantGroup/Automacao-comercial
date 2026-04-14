package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/scraper"
)

type webWorker struct {
	cfg     *config.Config
	queries *db.Queries
	scraper *scraper.Client
	client  *asynq.Client
}

func newWebWorker(cfg *config.Config, queries *db.Queries, scraperClient *scraper.Client, client *asynq.Client) *webWorker {
	return &webWorker{cfg: cfg, queries: queries, scraper: scraperClient, client: client}
}

type webPayload struct {
	CompanyID  string `json:"company_id"`
	CampaignID string `json:"campaign_id,omitempty"`
}

func (w *webWorker) Handle(ctx context.Context, t *asynq.Task) error {
	var p webPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal web payload: %w", err)
	}

	companyID, err := uuid.Parse(p.CompanyID)
	if err != nil {
		return fmt.Errorf("parse company_id: %w", err)
	}

	company, err := w.queries.GetCompany(ctx, companyID)
	if err != nil {
		return fmt.Errorf("get company: %w", err)
	}

	existingIntel, err := w.queries.GetIntelligence(ctx, companyID)
	if err != nil {
		existingIntel.CompanyID = companyID
	}

	slog.Info("Web enrichment started", "company_id", companyID, "name", company.Name)

	var websiteResult scraper.WebsiteResult
	var websiteDesc string
	var techStack []string
	var websiteIssues []string
	if company.Website != nil && *company.Website != "" {
		host := extractHost(*company.Website)
		if isSocialOrAggregatorHost(host) {
			websiteDesc = fmt.Sprintf("Canal digital informado em %s (rede social/agregador).", host)
			slog.Info("Skipping deep website scrape for social/aggregator host", "company_id", companyID, "host", host)
		} else {
			wsCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			defer cancel()

			wsResult, err := w.scraper.ScrapeWebsite(wsCtx, *company.Website)
			if err != nil {
				slog.Warn("Website scrape failed", "url", *company.Website, "error", err)
			} else {
				websiteResult = wsResult
				websiteDesc = buildWebsiteDescription(wsResult)
				techStack = dedupeNonEmptyStrings(wsResult.Technologies)
				websiteIssues = collectWebsiteIssueMessages(wsResult.Issues)
			}
		}
	}
	if strings.TrimSpace(websiteDesc) == "" {
		websiteDesc = strings.TrimSpace(ptrToString(existingIntel.WebsiteDescription))
	}
	if len(techStack) == 0 {
		techStack = parseJSONStringArray(existingIntel.TechStack)
	}

	var (
		repScore     float32
		repScorePtr  *float32
		repSummary   string
		reputationOK bool
		raResult     scraper.ReclameAquiResult
	)
	raCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	raResult, err = w.scraper.ScrapeReclameAqui(raCtx, company.Name)
	if err != nil {
		slog.Warn("Reclame Aqui scrape failed", "company", company.Name, "error", err)
	} else if raResult.Found {
		reputationOK = true
		repScore = raResult.Score
		repScorePtr = &repScore
		repSummary = buildReputationSummary(raResult)
	}
	if repScorePtr == nil {
		repScorePtr = existingIntel.ReputationScore
	}
	if strings.TrimSpace(repSummary) == "" {
		repSummary = strings.TrimSpace(ptrToString(existingIntel.ReputationSummary))
	}

	painSignals := dedupeNonEmptyStrings(buildReputationPainSignals(raResult))
	existingPain := parseJSONStringArray(existingIntel.PainPoints)
	painJSON, err := json.Marshal(dedupeNonEmptyStrings(append(existingPain, painSignals...)))
	if err != nil {
		return fmt.Errorf("marshal pain signals: %w", err)
	}

	techJSON, err := json.Marshal(techStack)
	if err != nil {
		return fmt.Errorf("marshal tech stack: %w", err)
	}

	webDataJSON, err := json.Marshal(map[string]interface{}{
		"captured_at":         time.Now().UTC().Format(time.RFC3339),
		"company_name":        company.Name,
		"website_url":         company.Website,
		"website_description": websiteDesc,
		"tech_stack":          techStack,
		"reputation_score":    repScorePtr,
		"reputation_summary":  repSummary,
		"website":             websiteResult,
		"reclame_aqui":        raResult,
		"derived": map[string]interface{}{
			"what_company_does": dedupeNonEmptyStrings(websiteResult.BusinessSignals.WhatCompanyDoes),
			"location_hints":    dedupeNonEmptyStrings(websiteResult.BusinessSignals.LocationHints),
			"site_issues":       websiteIssues,
			"pain_signals":      painSignals,
			"coverage": map[string]int{
				"pages_scanned":    websiteResult.PagesCount,
				"links":            len(websiteResult.Links),
				"emails":           len(websiteResult.ContactSignals.Emails),
				"phones":           len(websiteResult.ContactSignals.Phones),
				"whatsapp":         len(websiteResult.ContactSignals.WhatsAppNumbers),
				"social_links":     len(websiteResult.ContactSignals.SocialLinks),
				"contact_pages":    len(websiteResult.ContactSignals.ContactPages),
				"complaint_topics": len(raResult.ComplaintTopics),
			},
		},
	})
	if err != nil {
		return fmt.Errorf("marshal web data: %w", err)
	}

	params := db.UpsertIntelligenceParams{
		CompanyID:            companyID,
		Summary:              existingIntel.Summary,
		PainPoints:           painJSON,
		FitScore:             existingIntel.FitScore,
		FitJustification:     existingIntel.FitJustification,
		TechStack:            techJSON,
		ReputationScore:      repScorePtr,
		ReputationSummary:    strIfNotEmpty(repSummary),
		OpenJobs:             ensureJSONArray(existingIntel.OpenJobs),
		LinkedInFollowers:    existingIntel.LinkedInFollowers,
		LinkedInAbout:        existingIntel.LinkedInAbout,
		WebsiteDescription:   strIfNotEmpty(websiteDesc),
		PersonaPriority:      existingIntel.PersonaPriority,
		PersonaJustification: existingIntel.PersonaJustification,
		RawWebData:           webDataJSON,
		RawLinkedInData:      ensureJSONObject(existingIntel.RawLinkedInData),
	}

	if _, err := w.queries.UpsertIntelligence(ctx, params); err != nil {
		slog.Error("Upsert intelligence failed", "company_id", companyID, "error", err)
	}

	slog.Info("Web enrichment done", "company_id", companyID,
		"has_website_data", websiteDesc != "",
		"has_reputation", reputationOK,
		"tech_count", len(techStack))

	analyzePayload, err := json.Marshal(map[string]string{
		"company_id":  companyID.String(),
		"campaign_id": p.CampaignID,
	})
	if err != nil {
		return fmt.Errorf("marshal analyze payload: %w", err)
	}

	if _, err := w.client.Enqueue(
		asynq.NewTask(TaskAIAnalyze, analyzePayload),
		asynq.MaxRetry(3),
		asynq.Queue("ai"),
		asynq.ProcessIn(10*time.Second),
		asynq.Unique(10*time.Second),
	); err != nil {
		if !errors.Is(err, asynq.ErrDuplicateTask) {
			slog.Error("Enqueue AI analyze failed", "company_id", companyID, "error", err)
		}
	}

	return nil
}

func buildWebsiteDescription(result scraper.WebsiteResult) string {
	parts := []string{result.Description}
	if len(result.BusinessSignals.WhatCompanyDoes) > 0 {
		parts = append(parts, result.BusinessSignals.WhatCompanyDoes[0])
	}
	if strings.TrimSpace(result.Title) != "" {
		parts = append(parts, result.Title)
	}
	joined := stringsJoinNonEmpty(parts, " | ")
	if len(joined) > 500 {
		return strings.TrimSpace(joined[:497]) + "..."
	}
	return joined
}

func collectWebsiteIssueMessages(issues []scraper.WebsiteIssue) []string {
	out := make([]string, 0, len(issues))
	for _, issue := range issues {
		msg := strings.TrimSpace(issue.Message)
		if msg == "" {
			continue
		}
		if sev := strings.TrimSpace(issue.Severity); sev != "" {
			msg = fmt.Sprintf("[%s] %s", strings.ToUpper(sev), msg)
		}
		out = append(out, msg)
		if len(out) >= 12 {
			break
		}
	}
	return dedupeNonEmptyStrings(out)
}

func buildReputationSummary(result scraper.ReclameAquiResult) string {
	if !result.Found {
		return ""
	}
	parts := []string{
		fmt.Sprintf("Nota %.1f/10", result.Score),
		fmt.Sprintf("indice de solucao %.0f%%", result.SolutionRate*100),
		fmt.Sprintf("%d reclamacoes", result.ComplaintsCount),
	}
	if result.RespondedPercentage != nil {
		parts = append(parts, fmt.Sprintf("%.0f%% respondidas", *result.RespondedPercentage))
	}
	if len(result.ComplaintTopics) > 0 {
		parts = append(parts, "topicos: "+strings.Join(result.ComplaintTopics[:min(3, len(result.ComplaintTopics))], ", "))
	}
	return strings.Join(parts, ", ")
}

func buildReputationPainSignals(result scraper.ReclameAquiResult) []string {
	if !result.Found {
		return nil
	}
	out := make([]string, 0, 6)
	if result.Score > 0 && result.Score < 7 {
		out = append(out, fmt.Sprintf("Reputacao publica abaixo de 7/10 (%.1f).", result.Score))
	}
	if result.SolutionRate > 0 && result.SolutionRate < 0.7 {
		out = append(out, fmt.Sprintf("Indice de solucao abaixo de 70%% (%.0f%%).", result.SolutionRate*100))
	}
	if result.RespondedPercentage != nil && *result.RespondedPercentage < 80 {
		out = append(out, fmt.Sprintf("Percentual de resposta no Reclame Aqui abaixo de 80%% (%.0f%%).", *result.RespondedPercentage))
	}
	if len(result.ComplaintTopics) > 0 {
		out = append(out, "Topicos recorrentes no Reclame Aqui: "+strings.Join(result.ComplaintTopics[:min(4, len(result.ComplaintTopics))], ", "))
	}
	if len(result.RecentComplaints) > 0 {
		out = append(out, "Reclamacoes recentes: "+strings.Join(result.RecentComplaints[:min(3, len(result.RecentComplaints))], " | "))
	}
	return dedupeNonEmptyStrings(out)
}

func dedupeNonEmptyStrings(items []string) []string {
	out := make([]string, 0, len(items))
	seen := make(map[string]bool, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		key := strings.ToLower(item)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func ensureJSONArray(raw json.RawMessage) json.RawMessage {
	raw = json.RawMessage(bytes.TrimSpace(raw))
	if len(raw) == 0 || raw[0] != '[' {
		return json.RawMessage(`[]`)
	}
	return raw
}

func ensureJSONObject(raw json.RawMessage) json.RawMessage {
	raw = json.RawMessage(bytes.TrimSpace(raw))
	if len(raw) == 0 || raw[0] != '{' {
		return json.RawMessage(`{}`)
	}
	return raw
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func stringsJoinNonEmpty(parts []string, sep string) string {
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return strings.Join(out, sep)
}
