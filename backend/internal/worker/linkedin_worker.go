package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
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
	cfg      *config.Config
	queries  *db.Queries
	aiClient *ai.Client
	client   *asynq.Client
	limiter  *rate.Limiter
}

func newLinkedInWorker(cfg *config.Config, queries *db.Queries, aiClient *ai.Client, client *asynq.Client) *linkedInWorker {
	return &linkedInWorker{
		cfg:      cfg,
		queries:  queries,
		aiClient: aiClient,
		client:   client,
		limiter:  rate.NewLimiter(rate.Every(time.Second/5), 2), // 5 rps
	}
}

type linkedInPayload struct {
	CompanyID string `json:"company_id"`
}

type apolloPerson struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Title     string `json:"title"`
	Email     string `json:"email"`
	Phone     string `json:"phone"`
	LinkedInURL string `json:"linkedin_url"`
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

	var persons []apolloPerson

	// Try Apollo.io first (more reliable without OAuth)
	if w.cfg.ApolloAPIKey != "" {
		persons, err = w.searchApollo(ctx, company)
		if err != nil {
			slog.Warn("Apollo search failed, skipping LinkedIn enrichment", "company_id", companyID, "error", err)
		}
	}

	// Save stakeholders
	for _, person := range persons {
		if err := w.limiter.Wait(ctx); err != nil {
			return err
		}

		// Classify role with AI
		normalizedRole := "OTHER"
		if person.Title != "" && w.aiClient != nil {
			raw, err := w.aiClient.Complete(ctx,
				"You are a role classifier. Return only valid JSON.",
				ai.BuildRoleClassificationPrompt(person.Title))
			if err == nil {
				normalizedRole, _ = ai.ParseRole(raw)
			}
		}

		_, err := w.queries.CreateStakeholder(ctx, db.CreateStakeholderParams{
			CompanyID:      companyID,
			Name:           person.Name,
			NormalizedRole: strPtr(normalizedRole),
			RawTitle:       strIfNotEmpty(person.Title),
			LinkedInURL:    strIfNotEmpty(person.LinkedInURL),
			Email:          strIfNotEmpty(person.Email),
			Phone:          strIfNotEmpty(person.Phone),
			Source:         strPtr("apollo"),
		})
		if err != nil {
			slog.Error("Create stakeholder failed", "name", person.Name, "error", err)
		}
	}

	slog.Info("LinkedIn enrichment done", "company_id", companyID, "stakeholders", len(persons))

	// Check if web enrichment is also done so we can trigger AI analysis
	w.maybeEnqueueAnalysis(ctx, companyID)

	return nil
}

func (w *linkedInWorker) searchApollo(ctx context.Context, company db.Company) ([]apolloPerson, error) {
	domain := ""
	if company.Website != nil {
		domain = extractDomain(*company.Website)
	}

	payload := map[string]interface{}{
		"q_organization_name": company.Name,
		"organization_domains": []string{domain},
		"person_titles": []string{
			"CEO", "CTO", "COO", "CFO",
			"Head Comercial", "Head de Vendas", "Head de TI",
			"Diretor", "Director", "VP",
		},
		"page":     1,
		"per_page": 10,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.apollo.io/v1/mixed_people/search", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", w.cfg.ApolloAPIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("apollo API %d: %s", resp.StatusCode, string(b))
	}

	var result struct {
		People []apolloPerson `json:"people"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return result.People, nil
}

func (w *linkedInWorker) maybeEnqueueAnalysis(ctx context.Context, companyID uuid.UUID) {
	company, err := w.queries.GetCompany(ctx, companyID)
	if err != nil {
		return
	}
	// If both enrichments are done or intelligence already exists, trigger analysis
	if company.EnrichmentStatus == "processing" {
		payload, _ := json.Marshal(map[string]string{"company_id": companyID.String()})
		if _, err := w.client.Enqueue(
			asynq.NewTask(TaskAIAnalyze, payload),
			asynq.MaxRetry(3),
			asynq.Queue("ai"),
			asynq.ProcessIn(5*time.Second), // small delay for web worker to finish
		); err != nil {
			slog.Error("Enqueue AI analyze failed", "company_id", companyID, "error", err)
		}
	}
}

func extractDomain(website string) string {
	website = strings.TrimPrefix(website, "https://")
	website = strings.TrimPrefix(website, "http://")
	website = strings.TrimPrefix(website, "www.")
	if idx := strings.Index(website, "/"); idx >= 0 {
		website = website[:idx]
	}
	return website
}
