package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/hunter"
)

type hunterWorker struct {
	cfg          *config.Config
	queries      *db.Queries
	client       *asynq.Client
	hunterClient *hunter.Client
}

func newHunterWorker(cfg *config.Config, queries *db.Queries, client *asynq.Client) *hunterWorker {
	var hc *hunter.Client
	if cfg.HunterAPIKey != "" {
		hc = hunter.NewClient(cfg.HunterAPIKey)
	}
	return &hunterWorker{
		cfg:          cfg,
		queries:      queries,
		client:       client,
		hunterClient: hc,
	}
}

type hunterPayload struct {
	CompanyID string `json:"company_id"`
}

func (w *hunterWorker) Handle(ctx context.Context, t *asynq.Task) error {
	if w.hunterClient == nil {
		return nil
	}

	var p hunterPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal hunter payload: %w", err)
	}

	companyID, err := uuid.Parse(p.CompanyID)
	if err != nil {
		return fmt.Errorf("parse company_id: %w", err)
	}

	company, err := w.queries.GetCompany(ctx, companyID)
	if err != nil {
		return fmt.Errorf("get company: %w", err)
	}

	if company.Website == nil || *company.Website == "" {
		return nil
	}

	domain := extractDomain(*company.Website)
	if domain == "" {
		return nil
	}

	_ = w.queries.UpdateCompanyEnrichmentStatus(ctx, companyID, "processing")

	resp, err := w.hunterClient.DomainSearch(ctx, domain)
	if err != nil {
		w.maybeEnqueueAnalysis(ctx, companyID)
		return fmt.Errorf("hunter API failed: %w", err)
	}

	for _, email := range resp.Data.Emails {
		if email.Confidence < 50 && email.Type != "personal" {
			continue
		}

		name := strings.TrimSpace(email.FirstName + " " + email.LastName)
		if name == "" {
			name = "Unknown Contact"
		}

		_, _ = w.queries.CreateStakeholder(ctx, db.CreateStakeholderParams{
			CompanyID:      companyID,
			Name:           name,
			NormalizedRole: strPtr("OTHER"),
			RawTitle:       strIfNotEmpty(email.Position),
			LinkedInURL:    nil,
			Email:          strIfNotEmpty(email.Value),
			Phone:          nil,
			Source:         strPtr("hunter"),
		})
	}

	w.maybeEnqueueAnalysis(ctx, companyID)
	return nil
}

func (w *hunterWorker) maybeEnqueueAnalysis(ctx context.Context, companyID uuid.UUID) {
	company, err := w.queries.GetCompany(ctx, companyID)
	if err != nil {
		return
	}
	
	if company.EnrichmentStatus == "processing" {
		payload, _ := json.Marshal(map[string]string{"company_id": companyID.String()})
		_, _ = w.client.Enqueue(
			asynq.NewTask(TaskAIAnalyze, payload),
			asynq.MaxRetry(3),
			asynq.Queue("ai"),
			asynq.ProcessIn(5*time.Second),
		)
	}
}
