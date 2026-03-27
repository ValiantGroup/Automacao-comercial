package handler

import (
	"encoding/json"
	"log/slog"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/worker"
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

func (h *CampaignHandler) Create(c *fiber.Ctx) error {
	var body struct {
		Name       string   `json:"name"`
		Niche      string   `json:"niche"`
		City       string   `json:"city"`
		RadiusKM   int32    `json:"radius_km"`
		DailyLimit int32    `json:"daily_limit"`
		AutoSend   bool     `json:"auto_send"`
		Channels   []string `json:"channels"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	if body.Name == "" || body.Niche == "" || body.City == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name, niche, and city are required"})
	}

	if body.RadiusKM == 0 {
		body.RadiusKM = 10
	}
	if body.DailyLimit == 0 {
		body.DailyLimit = 50
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
		Name:            body.Name,
		Niche:           body.Niche,
		City:            body.City,
		RadiusKM:        body.RadiusKM,
		DailyLimit:      body.DailyLimit,
		AutoSend:        body.AutoSend,
		AIPromptContext: "",
		Channels:        channelsJSON,
		CreatedBy:       createdBy,
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
		Name       *string  `json:"name"`
		DailyLimit *int32   `json:"daily_limit"`
		AutoSend   *bool    `json:"auto_send"`
		Channels   []string `json:"channels"`
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

	updated, err := h.queries.UpdateCampaign(c.Context(), db.UpdateCampaignParams{
		ID:              campaign.ID,
		Name:            campaign.Name,
		Niche:           campaign.Niche,
		City:            campaign.City,
		RadiusKM:        campaign.RadiusKM,
		DailyLimit:      campaign.DailyLimit,
		AutoSend:        campaign.AutoSend,
		AIPromptContext: campaign.AIPromptContext,
		Channels:        campaign.Channels,
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

	// Enqueue prospect task
	payload, err := json.Marshal(worker.ProspectPayload{
		Niche:      campaign.Niche,
		City:       campaign.City,
		RadiusKM:   int(campaign.RadiusKM),
		CampaignID: id.String(),
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
	return c.JSON(updated)
}
