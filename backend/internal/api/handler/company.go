package handler

import (
	"encoding/json"
	"log/slog"
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/valiant-group/prospector/internal/api"
	db "github.com/valiant-group/prospector/internal/db/generated"
)

type CompanyHandler struct {
	queries     *db.Queries
	hub         *api.Hub
	asynqClient *asynq.Client
}

func NewCompanyHandler(queries *db.Queries, hub *api.Hub, asynqClient *asynq.Client) *CompanyHandler {
	return &CompanyHandler{queries: queries, hub: hub, asynqClient: asynqClient}
}

func (h *CompanyHandler) List(c *fiber.Ctx) error {
	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	offset, _ := strconv.Atoi(c.Query("offset", "0"))

	if limit > 200 {
		limit = 200
	}

	companies, err := h.queries.ListCompanies(c.Context(), int32(limit), int32(offset))
	if err != nil {
		slog.Error("List companies", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list companies"})
	}

	total, _ := h.queries.CountCompanies(c.Context())
	return c.JSON(fiber.Map{
		"data":   companies,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *CompanyHandler) Get(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid company id"})
	}

	company, err := h.queries.GetCompany(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "company not found"})
	}
	return c.JSON(company)
}

func (h *CompanyHandler) GetIntelligence(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid company id"})
	}

	intel, err := h.queries.GetIntelligence(c.Context(), id)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "intelligence not found"})
	}
	return c.JSON(intel)
}

func (h *CompanyHandler) GetStakeholders(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid company id"})
	}

	stakeholders, err := h.queries.ListStakeholdersByCompany(c.Context(), id)
	if err != nil {
		slog.Error("List stakeholders", "company_id", id, "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list stakeholders"})
	}
	return c.JSON(fiber.Map{"data": stakeholders})
}

func (h *CompanyHandler) GetMessages(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid company id"})
	}

	messages, err := h.queries.ListMessagesByCompany(c.Context(), id)
	if err != nil {
		slog.Error("List messages", "company_id", id, "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list messages"})
	}
	return c.JSON(fiber.Map{"data": messages})
}

func (h *CompanyHandler) UpdateStage(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid company id"})
	}

	var body struct {
		Stage string `json:"stage"`
	}
	if err := c.BodyParser(&body); err != nil || body.Stage == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "stage required"})
	}

	validStages := map[string]bool{
		"prospected": true, "enriched": true, "analyzed": true, "approved": true,
		"contacted": true, "replied": true, "meeting": true, "lost": true,
	}
	if !validStages[body.Stage] {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid stage"})
	}

	company, err := h.queries.UpdateCompanyStage(c.Context(), id, body.Stage)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to update stage"})
	}

	// Emit pipeline event
	payload, _ := json.Marshal(fiber.Map{"stage": body.Stage, "user_id": c.Locals("user_id")})
	h.queries.CreatePipelineEvent(c.Context(), id, "stage_changed", payload)

	// Broadcast to WS clients
	h.hub.Broadcast("stage_changed", fiber.Map{"company_id": id, "stage": body.Stage})

	return c.JSON(company)
}

func (h *CompanyHandler) Delete(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid company id"})
	}

	if err := h.queries.DeleteCompany(c.Context(), id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to delete company"})
	}
	return c.SendStatus(fiber.StatusNoContent)
}
