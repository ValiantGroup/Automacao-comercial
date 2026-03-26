package handler

import (
	"log/slog"

	"github.com/gofiber/fiber/v2"

	db "github.com/valiant-group/prospector/internal/db/generated"
)

type DashboardHandler struct {
	queries *db.Queries
}

func NewDashboardHandler(queries *db.Queries) *DashboardHandler {
	return &DashboardHandler{queries: queries}
}

func (h *DashboardHandler) Stats(c *fiber.Ctx) error {
	totalCompanies, err := h.queries.CountCompanies(c.Context())
	if err != nil {
		slog.Error("Count companies", "error", err)
		totalCompanies = 0
	}

	todayCompanies, err := h.queries.CountCompaniesToday(c.Context())
	if err != nil {
		todayCompanies = 0
	}

	outreachStats, err := h.queries.GetOutreachStats(c.Context())
	if err != nil {
		slog.Error("Get outreach stats", "error", err)
	}

	sentToday, _ := h.queries.CountSentToday(c.Context())

	var openRate float64
	if outreachStats.TotalSent > 0 {
		openRate = float64(outreachStats.TotalOpened) / float64(outreachStats.TotalSent) * 100
	}

	return c.JSON(fiber.Map{
		"total_companies":       totalCompanies,
		"companies_today":       todayCompanies,
		"pending_review":        outreachStats.PendingReview,
		"sent_today":            sentToday,
		"total_sent":            outreachStats.TotalSent,
		"total_opened":          outreachStats.TotalOpened,
		"total_replied":         outreachStats.TotalReplied,
		"email_open_rate_pct":   openRate,
	})
}
