package handler

import (
	"encoding/json"
	"log/slog"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/hibiken/asynq"

	"github.com/valiant-group/prospector/internal/api"
	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/worker"
)

type OutreachHandler struct {
	queries     *db.Queries
	asynqClient *asynq.Client
	hub         *api.Hub
}

func NewOutreachHandler(queries *db.Queries, asynqClient *asynq.Client, hub *api.Hub) *OutreachHandler {
	return &OutreachHandler{queries: queries, asynqClient: asynqClient, hub: hub}
}

func (h *OutreachHandler) PendingReview(c *fiber.Ctx) error {
	messages, err := h.queries.ListPendingReview(c.Context())
	if err != nil {
		slog.Error("List pending review", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to list messages"})
	}
	return c.JSON(fiber.Map{"data": messages})
}

func (h *OutreachHandler) Approve(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid message id"})
	}

	// Optionally accept an edited content in request body
	var body struct {
		Content *string `json:"content"`
		Subject *string `json:"subject"`
	}
	c.BodyParser(&body)

	msg, err := h.queries.UpdateMessageStatus(c.Context(), id, "approved")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to approve message"})
	}

	// Enqueue send task
	payload, _ := json.Marshal(worker.ProspectPayload{})
	sendPayload, _ := json.Marshal(map[string]string{"message_id": id.String()})

	if _, err := h.asynqClient.Enqueue(
		asynq.NewTask(worker.TaskOutreachSend, sendPayload),
		asynq.MaxRetry(3),
		asynq.Queue("critical"),
	); err != nil {
		slog.Error("Enqueue outreach send", "message_id", id, "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to enqueue send task"})
	}

	_ = payload
	h.hub.Broadcast("message_approved", fiber.Map{"message_id": id, "company_id": msg.CompanyID})

	slog.Info("Message approved and queued for send", "message_id", id)
	return c.JSON(msg)
}

func (h *OutreachHandler) Reject(c *fiber.Ctx) error {
	id, err := uuid.Parse(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid message id"})
	}

	msg, err := h.queries.UpdateMessageStatus(c.Context(), id, "rejected")
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to reject message"})
	}
	return c.JSON(msg)
}

func (h *OutreachHandler) Stats(c *fiber.Ctx) error {
	stats, err := h.queries.GetOutreachStats(c.Context())
	if err != nil {
		slog.Error("Get outreach stats", "error", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to get stats"})
	}
	return c.JSON(stats)
}
