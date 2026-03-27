package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
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
	CompanyID string `json:"company_id"`
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

	// Scrape website
	var websiteDesc string
	var techStack []string
	if company.Website != nil && *company.Website != "" {
		wsCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		defer cancel()

		wsResult, err := w.scraper.ScrapeWebsite(wsCtx, *company.Website)
		if err != nil {
			slog.Warn("Website scrape failed", "url", *company.Website, "error", err)
		} else {
			websiteDesc = wsResult.Title + " — " + wsResult.Description
			techStack = wsResult.Technologies
		}
	}

	// Scrape Reclame Aqui
	var repScore float32
	var repSummary string
	raCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	raResult, err := w.scraper.ScrapeReclameAqui(raCtx, company.Name)
	if err != nil {
		slog.Warn("Reclame Aqui scrape failed", "company", company.Name, "error", err)
	} else if raResult.Found {
		repScore = raResult.Score
		repSummary = fmt.Sprintf("%.1f/10, taxa de solução %.0f%%, %d reclamações",
			raResult.Score, raResult.SolutionRate*100, raResult.ComplaintsCount)
	}

	// Build intelligence payload
	techJSON, err := json.Marshal(techStack)
	if err != nil {
		return fmt.Errorf("marshal tech stack: %w", err)
	}
	webDataJSON, err := json.Marshal(map[string]interface{}{
		"website_description": websiteDesc,
		"tech_stack":          techStack,
		"reputation_score":    repScore,
		"reputation_summary":  repSummary,
	})
	if err != nil {
		return fmt.Errorf("marshal web data: %w", err)
	}

	params := db.UpsertIntelligenceParams{
		CompanyID:          companyID,
		WebsiteDescription: strIfNotEmpty(websiteDesc),
		TechStack:          techJSON,
		ReputationScore:    &repScore,
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
		"has_reputation", raResult.Found,
		"tech_count", len(techStack))

	// Enqueue analysis (after a delay so LinkedIn worker can also finish)
	analyzePayload, err := json.Marshal(map[string]string{"company_id": companyID.String()})
	if err != nil {
		return fmt.Errorf("marshal analyze payload: %w", err)
	}
	if _, err := w.client.Enqueue(
		asynq.NewTask(TaskAIAnalyze, analyzePayload),
		asynq.MaxRetry(3),
		asynq.Queue("ai"),
		asynq.ProcessIn(10*time.Second),
		asynq.Unique(10*time.Second), // deduplicate: only one analyze task per company per 10s
	); err != nil {
		if !errors.Is(err, asynq.ErrDuplicateTask) {
			slog.Error("Enqueue AI analyze failed", "company_id", companyID, "error", err)
		}
	}

	return nil
}
