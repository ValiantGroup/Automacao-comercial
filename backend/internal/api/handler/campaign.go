package handler

import (
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/worker"
)

const (
	defaultRadiusKM               int32 = 10
	defaultDailyLimit             int32 = 50
	defaultMinGoogleReviews       int32 = 100
	defaultMaxCompanies           int32 = 60
	defaultMinAIScoreStakeholders int32 = 60
)

type CampaignHandler struct {
	queries     *db.Queries
	asynqClient *asynq.Client
}

func NewCampaignHandler(queries *db.Queries, asynqClient *asynq.Client) *CampaignHandler {
	return &CampaignHandler{queries: queries, asynqClient: asynqClient}
}

func (h *CampaignHandler) List(c *fiber.Ctx) error {
	campaigns, err := h.queries.ListCampaigns(c.Context())
	if err != nil {
		slog.Error("List campaigns", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list campaigns"})
	}
	return c.JSON(fiber.Map{"data": campaigns})
}

func (h *CampaignHandler) Get(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid campaign id"})
	}
	campaign, err := h.queries.GetCampaign(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campaign not found"})
	}
	return c.JSON(campaign)
}

func (h *CampaignHandler) Progress(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid campaign id"})
	}

	campaign, err := h.queries.GetCampaign(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campaign not found"})
	}

	companies, err := h.queries.CountCampaignCompanies(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to count campaign companies"})
	}
	analyzed, err := h.queries.CountCampaignAnalyzedCompanies(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to count analyzed companies"})
	}
	stakeholders, err := h.queries.CountCampaignStakeholders(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to count stakeholders"})
	}
	messages, err := h.queries.CountCampaignMessages(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to count messages"})
	}

	overallProgressPct := 0.0
	if campaign.MaxCompanies > 0 {
		overallProgressPct = float64(companies) * 100 / float64(campaign.MaxCompanies)
		if overallProgressPct > 100 {
			overallProgressPct = 100
		}
	}

	searchProgressPct := 0.0
	if campaign.SearchTotalFound > 0 {
		searchProgressPct = float64(campaign.SearchProcessed) * 100 / float64(campaign.SearchTotalFound)
		if searchProgressPct > 100 {
			searchProgressPct = 100
		}
	}

	return c.JSON(fiber.Map{
		"campaign_id":           campaign.ID,
		"status":                campaign.Status,
		"overall_progress_pct":  overallProgressPct,
		"search_progress_pct":   searchProgressPct,
		"target_max_companies":  campaign.MaxCompanies,
		"companies_in_campaign": companies,
		"analyzed_companies":    analyzed,
		"stakeholders_found":    stakeholders,
		"messages_generated":    messages,
		"search": fiber.Map{
			"total_found":           campaign.SearchTotalFound,
			"processed":             campaign.SearchProcessed,
			"saved":                 campaign.SearchSaved,
			"skipped_low_reviews":   campaign.SearchSkippedLowReviews,
			"skipped_duplicate":     campaign.SearchSkippedDuplicate,
			"skipped_type":          campaign.SearchSkippedType,
			"errors":                campaign.SearchErrors,
			"last_started_at":       campaign.SearchLastStartedAt,
			"last_finished_at":      campaign.SearchLastFinishedAt,
			"min_google_reviews":    campaign.MinGoogleReviews,
			"max_companies":         campaign.MaxCompanies,
			"min_ai_score_required": campaign.MinAIScoreStakeholders,
		},
	})
}

func (h *CampaignHandler) Create(c *fiber.Ctx) error {
	var body struct {
		Name                      string   `json:"name"`
		Niche                     string   `json:"niche"`
		City                      string   `json:"city"`
		RadiusKM                  int32    `json:"radius_km"`
		DailyLimit                int32    `json:"daily_limit"`
		AutoSend                  bool     `json:"auto_send"`
		Channels                  []string `json:"channels"`
		MinGoogleReviews          *int32   `json:"min_google_reviews"`
		MaxCompanies              *int32   `json:"max_companies"`
		MinAIScoreForStakeholders *int32   `json:"min_ai_score_for_stakeholders"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	if body.Name == "" || body.Niche == "" || body.City == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name, niche, and city are required"})
	}

	minGoogleReviews, maxCompanies, minAIScore, err := normalizeCampaignControlValues(
		body.MinGoogleReviews,
		body.MaxCompanies,
		body.MinAIScoreForStakeholders,
	)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	if body.RadiusKM == 0 {
		body.RadiusKM = defaultRadiusKM
	}
	if body.DailyLimit == 0 {
		body.DailyLimit = defaultDailyLimit
	}
	if len(body.Channels) == 0 {
		body.Channels = []string{"whatsapp"}
	}

	channelsJSON, err := json.Marshal(body.Channels)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid channels"})
	}
	userID, _ := c.Locals("user_id").(string)
	createdBy, _ := uuid.Parse(userID)

	campaign, err := h.queries.CreateCampaign(c.Context(), db.CreateCampaignParams{
		Name:                   body.Name,
		Niche:                  body.Niche,
		City:                   body.City,
		RadiusKM:               body.RadiusKM,
		DailyLimit:             body.DailyLimit,
		AutoSend:               body.AutoSend,
		AIPromptContext:        "",
		Channels:               channelsJSON,
		CreatedBy:              createdBy,
		MinGoogleReviews:       minGoogleReviews,
		MaxCompanies:           maxCompanies,
		MinAIScoreStakeholders: minAIScore,
	})
	if err != nil {
		slog.Error("Create campaign", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create campaign"})
	}

	return c.Status(fiber.StatusCreated).JSON(campaign)
}

func (h *CampaignHandler) Update(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid campaign id"})
	}

	campaign, err := h.queries.GetCampaign(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campaign not found"})
	}

	var body struct {
		Name                      *string  `json:"name"`
		DailyLimit                *int32   `json:"daily_limit"`
		AutoSend                  *bool    `json:"auto_send"`
		Channels                  []string `json:"channels"`
		MinGoogleReviews          *int32   `json:"min_google_reviews"`
		MaxCompanies              *int32   `json:"max_companies"`
		MinAIScoreForStakeholders *int32   `json:"min_ai_score_for_stakeholders"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	// Apply patch
	if body.Name != nil {
		campaign.Name = *body.Name
	}
	if body.DailyLimit != nil {
		campaign.DailyLimit = *body.DailyLimit
	}
	if body.AutoSend != nil {
		campaign.AutoSend = *body.AutoSend
	}
	if len(body.Channels) > 0 {
		channelsJSON, marshalErr := json.Marshal(body.Channels)
		if marshalErr != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid channels"})
		}
		campaign.Channels = channelsJSON
	}

	minGoogleReviews, maxCompanies, minAIScore, err := normalizeCampaignControlValues(
		valueOrPtr(body.MinGoogleReviews, campaign.MinGoogleReviews),
		valueOrPtr(body.MaxCompanies, campaign.MaxCompanies),
		valueOrPtr(body.MinAIScoreForStakeholders, campaign.MinAIScoreStakeholders),
	)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	campaign.MinGoogleReviews = minGoogleReviews
	campaign.MaxCompanies = maxCompanies
	campaign.MinAIScoreStakeholders = minAIScore

	updated, err := h.queries.UpdateCampaign(c.Context(), db.UpdateCampaignParams{
		ID:                     campaign.ID,
		Name:                   campaign.Name,
		Niche:                  campaign.Niche,
		City:                   campaign.City,
		RadiusKM:               campaign.RadiusKM,
		DailyLimit:             campaign.DailyLimit,
		AutoSend:               campaign.AutoSend,
		AIPromptContext:        campaign.AIPromptContext,
		Channels:               campaign.Channels,
		MinGoogleReviews:       campaign.MinGoogleReviews,
		MaxCompanies:           campaign.MaxCompanies,
		MinAIScoreStakeholders: campaign.MinAIScoreStakeholders,
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update campaign"})
	}
	return c.JSON(updated)
}

func (h *CampaignHandler) Delete(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid campaign id"})
	}
	if err := h.queries.DeleteCampaign(c.Context(), id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to delete campaign"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (h *CampaignHandler) Start(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid campaign id"})
	}

	campaign, err := h.queries.GetCampaign(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "campaign not found"})
	}

	if campaign.Status == "running" {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "campaign is already running"})
	}

	if err := h.queries.BeginCampaignSearchRun(c.Context(), id, 0); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to initialize campaign progress"})
	}

	// Enqueue prospect task
	payload, err := json.Marshal(worker.ProspectPayload{
		Niche:            campaign.Niche,
		City:             campaign.City,
		RadiusKM:         int(campaign.RadiusKM),
		CampaignID:       id.String(),
		MinGoogleReviews: int(campaign.MinGoogleReviews),
		MaxCompanies:     int(campaign.MaxCompanies),
	})
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to start campaign"})
	}

	if _, err := h.asynqClient.Enqueue(
		asynq.NewTask(worker.TaskProspect, payload),
		asynq.MaxRetry(1),
		asynq.Queue("critical"),
	); err != nil {
		slog.Error("Enqueue prospect task", "campaign_id", id, "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to start campaign"})
	}

	updated, err := h.queries.UpdateCampaignStatus(c.Context(), id, "running")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update campaign status"})
	}

	slog.Info("Campaign started", "campaign_id", id, "niche", campaign.Niche, "city", campaign.City)
	return c.JSON(updated)
}

func (h *CampaignHandler) Pause(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid campaign id"})
	}
	updated, err := h.queries.UpdateCampaignStatus(c.Context(), id, "paused")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to pause campaign"})
	}
	_ = h.queries.MarkCampaignSearchFinished(c.Context(), id)
	return c.JSON(updated)
}

func normalizeCampaignControlValues(minGoogleReviews, maxCompanies, minAIScore *int32) (int32, int32, int32, error) {
	minReviews := defaultMinGoogleReviews
	if minGoogleReviews != nil {
		minReviews = *minGoogleReviews
	}
	if minReviews < 0 {
		return 0, 0, 0, errors.New("min_google_reviews must be >= 0")
	}

	max := defaultMaxCompanies
	if maxCompanies != nil {
		max = *maxCompanies
	}
	if max < 1 {
		return 0, 0, 0, errors.New("max_companies must be >= 1")
	}

	minAI := defaultMinAIScoreStakeholders
	if minAIScore != nil {
		minAI = *minAIScore
	}
	if minAI < 60 || minAI > 100 {
		return 0, 0, 0, errors.New("min_ai_score_for_stakeholders must be between 60 and 100")
	}

	return minReviews, max, minAI, nil
}

func valueOrPtr(v *int32, fallback int32) *int32 {
	if v != nil {
		return v
	}
	return &fallback
}
