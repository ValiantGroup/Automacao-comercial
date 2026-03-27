package worker

import (
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

	slog.Info("Web enrichment started", "company_id", companyID, "name", company.Name)

	var websiteDesc string
	var techStack []string
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
				websiteDesc = stringsJoinNonEmpty([]string{wsResult.Title, wsResult.Description}, " - ")
				techStack = wsResult.Technologies
			}
		}
	}

	var (
		repScore     float32
		repScorePtr  *float32
		repSummary   string
		reputationOK bool
	)
	raCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	raResult, err := w.scraper.ScrapeReclameAqui(raCtx, company.Name)
	if err != nil {
		slog.Warn("Reclame Aqui scrape failed", "company", company.Name, "error", err)
	} else if raResult.Found {
		reputationOK = true
		repScore = raResult.Score
		repScorePtr = &repScore
		repSummary = fmt.Sprintf("%.1f/10, taxa de solucao %.0f%%, %d reclamacoes",
			raResult.Score, raResult.SolutionRate*100, raResult.ComplaintsCount)
	}

	techJSON, err := json.Marshal(techStack)
	if err != nil {
		return fmt.Errorf("marshal tech stack: %w", err)
	}
	webDataJSON, err := json.Marshal(map[string]interface{}{
		"website_url":         company.Website,
		"website_description": websiteDesc,
		"tech_stack":          techStack,
		"reputation_score":    repScorePtr,
		"reputation_summary":  repSummary,
	})
	if err != nil {
		return fmt.Errorf("marshal web data: %w", err)
	}

	params := db.UpsertIntelligenceParams{
		CompanyID:          companyID,
		WebsiteDescription: strIfNotEmpty(websiteDesc),
		TechStack:          techJSON,
		ReputationScore:    repScorePtr,
		ReputationSummary:  strIfNotEmpty(repSummary),
		RawWebData:         webDataJSON,
		PainPoints:         json.RawMessage(`[]`),
		OpenJobs:           json.RawMessage(`[]`),
		RawLinkedInData:    json.RawMessage(`{}`),
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
