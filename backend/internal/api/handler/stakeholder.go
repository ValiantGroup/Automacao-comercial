package handler

import (
	"log/slog"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"

	db "github.com/valiant-group/prospector/internal/db/generated"
)

type StakeholderHandler struct {
	queries *db.Queries
}

func NewStakeholderHandler(queries *db.Queries) *StakeholderHandler {
	return &StakeholderHandler{queries: queries}
}

func (h *StakeholderHandler) List(c *fiber.Ctx) error {
	companyID, err := uuid.Parse(c.Params("company_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid company_id"})
	}

	stakeholders, err := h.queries.ListStakeholdersByCompany(c.Context(), companyID)
	if err != nil {
		slog.Error("List stakeholders", "company_id", companyID, "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list stakeholders"})
	}
	return c.JSON(fiber.Map{"data": stakeholders})
}

func (h *StakeholderHandler) Create(c *fiber.Ctx) error {
	companyID, err := uuid.Parse(c.Params("company_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid company_id"})
	}

	var body struct {
		Name           string  `json:"name"`
		NormalizedRole *string `json:"normalized_role"`
		RawTitle       *string `json:"raw_title"`
		LinkedInURL    *string `json:"linkedin_url"`
		Email          *string `json:"email"`
		Phone          *string `json:"phone"`
	}
	if err := c.BodyParser(&body); err != nil || body.Name == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "name is required"})
	}

	source := "manual"
	stakeholder, err := h.queries.CreateStakeholder(c.Context(), db.CreateStakeholderParams{
		CompanyID:      companyID,
		Name:           body.Name,
		NormalizedRole: body.NormalizedRole,
		RawTitle:       body.RawTitle,
		LinkedInURL:    body.LinkedInURL,
		Email:          body.Email,
		Phone:          body.Phone,
		Source:         &source,
	})
	if err != nil {
		slog.Error("Create stakeholder", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to create stakeholder"})
	}

	return c.Status(fiber.StatusCreated).JSON(stakeholder)
}
