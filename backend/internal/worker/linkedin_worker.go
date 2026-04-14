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
	"golang.org/x/time/rate"

	"github.com/valiant-group/prospector/internal/ai"
	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
)

type linkedInWorker struct {
	cfg              *config.Config
	queries          *db.Queries
	aiClient         *ai.Client
	client           *asynq.Client
	limiter          *rate.Limiter
	providerRegistry *stakeholderProviderRegistry
}

func newLinkedInWorker(cfg *config.Config, queries *db.Queries, aiClient *ai.Client, client *asynq.Client) *linkedInWorker {
	return &linkedInWorker{
		cfg:              cfg,
		queries:          queries,
		aiClient:         aiClient,
		client:           client,
		limiter:          rate.NewLimiter(rate.Every(time.Second/5), 2), // 5 rps
		providerRegistry: newStakeholderProviderRegistry(cfg),
	}
}

type linkedInPayload struct {
	CompanyID  string `json:"company_id"`
	CampaignID string `json:"campaign_id,omitempty"`
}

func (w *linkedInWorker) Handle(ctx context.Context, t *asynq.Task) error {
	var p linkedInPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal linkedin payload: %w", err)
	}

	companyID, err := uuid.Parse(p.CompanyID)
	if err != nil {
		return fmt.Errorf("parse company_id: %w", err)
	}

	company, err := w.queries.GetCompany(ctx, companyID)
	if err != nil {
		return fmt.Errorf("get company: %w", err)
	}

	if err := w.queries.UpdateCompanyEnrichmentStatus(ctx, companyID, "processing"); err != nil {
		slog.Warn("Could not update enrichment status", "company_id", companyID, "error", err)
	}

	candidates, providerUsed, err := w.providerRegistry.FindWithFallback(ctx, company)
	if err != nil {
		slog.Warn("Stakeholder providers failed", "company_id", companyID, "error", err)
	}

	// Save stakeholders
	for _, candidate := range candidates {
		if err := w.limiter.Wait(ctx); err != nil {
			return err
		}

		name := strings.TrimSpace(candidate.Name)
		if name == "" {
			continue
		}

		titleVal := ""
		if candidate.RawTitle != nil {
			titleVal = strings.TrimSpace(*candidate.RawTitle)
		}

		// Prefer deterministic classification so roles are still useful when AI is unstable.
		normalizedRole := classifyNormalizedRole(titleVal, ptrToString(candidate.Email))
		if normalizedRole == "OTHER" && titleVal != "" && w.aiClient != nil {
			raw, err := w.aiClient.Complete(ctx,
				"You are a role classifier. Return only valid JSON.",
				ai.BuildRoleClassificationPrompt(titleVal))
			if err == nil {
				if role, parseErr := ai.ParseRole(raw); parseErr == nil {
					normalizedRole = role
				}
			}
		}

		_, err := w.queries.CreateStakeholder(ctx, db.CreateStakeholderParams{
			CompanyID:      companyID,
			Name:           name,
			NormalizedRole: strPtr(normalizedRole),
			RawTitle:       strIfNotEmpty(titleVal),
			LinkedInURL:    nil,
			Email:          candidate.Email,
			Phone:          candidate.Phone,
			Source:         strPtr(candidate.Source),
		})
		if err != nil {
			slog.Error("Create stakeholder failed", "name", name, "error", err)
		}
	}

	slog.Info("LinkedIn enrichment done", "company_id", companyID, "stakeholders", len(candidates), "provider", providerUsed)

	if err := w.enqueueMessageGeneration(companyID, p.CampaignID); err != nil {
		slog.Error("Enqueue AI generate after stakeholder enrichment failed", "company_id", companyID, "error", err)
	}

	return nil
}

func (w *linkedInWorker) enqueueMessageGeneration(companyID uuid.UUID, campaignID string) error {
	if strings.TrimSpace(campaignID) == "" {
		return nil
	}

	payload, err := json.Marshal(map[string]string{
		"company_id":  companyID.String(),
		"campaign_id": campaignID,
	})
	if err != nil {
		return fmt.Errorf("marshal AI generate payload: %w", err)
	}

	if _, err := w.client.Enqueue(
		asynq.NewTask(TaskAIGenerate, payload),
		asynq.MaxRetry(3),
		asynq.Queue("ai"),
		asynq.Unique(30*time.Second),
	); err != nil && !errors.Is(err, asynq.ErrDuplicateTask) {
		return fmt.Errorf("enqueue AI generate task: %w", err)
	}
	return nil
}
