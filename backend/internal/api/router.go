package api

import (
	"github.com/gofiber/fiber/v2"
	"github.com/hibiken/asynq"

	"github.com/valiant-group/prospector/internal/ai"
	"github.com/valiant-group/prospector/internal/api/handler"
	"github.com/valiant-group/prospector/internal/api/middleware"
	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/outreach"
	"github.com/valiant-group/prospector/internal/scraper"
)

// RegisterRoutes mounts all API routes onto the Fiber app.
func RegisterRoutes(
	app *fiber.App,
	queries *db.Queries,
	aiClient *ai.Client,
	scraperClient *scraper.Client,
	evolutionClient *outreach.EvolutionClient,
	sendgridClient *outreach.SendGridClient,
	asynqClient *asynq.Client,
	hub *Hub,
	cfg *config.Config,
) {
	authHandler := handler.NewAuthHandler(queries, cfg.JWTSecret)
	companyHandler := handler.NewCompanyHandler(queries, hub, asynqClient)
	campaignHandler := handler.NewCampaignHandler(queries, asynqClient)
	outreachHandler := handler.NewOutreachHandler(queries, asynqClient, hub)
	dashboardHandler := handler.NewDashboardHandler(queries)

	// Public routes
	auth := app.Group("/api/auth", middleware.RateLimit(10))
	auth.Post("/login", authHandler.Login)
	auth.Post("/refresh", authHandler.Refresh)

	// Protected routes
	api := app.Group("/api", middleware.Auth(cfg.JWTSecret), middleware.RateLimit(200))

	// Companies
	companies := api.Group("/companies")
	companies.Get("/", companyHandler.List)
	companies.Get("/:id", companyHandler.Get)
	companies.Get("/:id/intelligence", companyHandler.GetIntelligence)
	companies.Get("/:id/stakeholders", companyHandler.GetStakeholders)
	companies.Get("/:id/messages", companyHandler.GetMessages)
	companies.Patch("/:id/stage", companyHandler.UpdateStage)
	companies.Delete("/:id", companyHandler.Delete)

	// Campaigns
	campaigns := api.Group("/campaigns")
	campaigns.Get("/", campaignHandler.List)
	campaigns.Post("/", campaignHandler.Create)
	campaigns.Get("/:id", campaignHandler.Get)
	campaigns.Patch("/:id", campaignHandler.Update)
	campaigns.Delete("/:id", campaignHandler.Delete)
	campaigns.Post("/:id/start", campaignHandler.Start)
	campaigns.Post("/:id/pause", campaignHandler.Pause)

	// Outreach
	out := api.Group("/outreach")
	out.Get("/pending-review", outreachHandler.PendingReview)
	out.Post("/:id/approve", outreachHandler.Approve)
	out.Post("/:id/reject", outreachHandler.Reject)
	out.Get("/stats", outreachHandler.Stats)

	// Dashboard
	api.Get("/dashboard/stats", dashboardHandler.Stats)
}
