package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/compress"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/gofiber/websocket/v2"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/valiant-group/prospector/internal/ai"
	"github.com/valiant-group/prospector/internal/api"
	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/outreach"
	"github.com/valiant-group/prospector/internal/scraper"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	cfg := config.Load()

	// ─── PostgreSQL ──────────────────────────────────────────────────────────
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("Connect PostgreSQL failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		slog.Error("PostgreSQL ping failed", "error", err)
		os.Exit(1)
	}
	slog.Info("PostgreSQL connected")

	// ─── Redis ───────────────────────────────────────────────────────────────
	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		slog.Error("Parse Redis URL failed", "error", err)
		os.Exit(1)
	}
	redisClient := redis.NewClient(redisOpts)
	if err := redisClient.Ping(ctx).Err(); err != nil {
		slog.Error("Redis ping failed", "error", err)
		os.Exit(1)
	}
	slog.Info("Redis connected")
	defer redisClient.Close()

	// ─── Dependencies ─────────────────────────────────────────────────────────
	queries := db.NewPool(pool)
	aiClient := ai.NewClient(cfg.OpenAIAPIKey)
	scraperClient := scraper.NewClient(cfg.PlaywrightSvcURL)
	evolutionClient := outreach.NewEvolutionClient(cfg.EvolutionAPIURL, cfg.EvolutionAPIKey, "valiant")
	sendgridClient := outreach.NewSendGridClient(cfg.SendGridAPIKey, cfg.SendGridFromEmail)

	asynqRedisOpt := asynq.RedisClientOpt{Addr: redisOpts.Addr}
	asynqClient := asynq.NewClient(asynqRedisOpt)
	defer asynqClient.Close()

	// ─── WebSocket Hub ────────────────────────────────────────────────────────
	hub := api.NewHub()
	go hub.Run()

	// ─── Fiber app ────────────────────────────────────────────────────────────
	app := fiber.New(fiber.Config{
		AppName:      "Valiant Prospector API",
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	})

	app.Use(recover.New())
	app.Use(compress.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     "*",
		AllowMethods:     "GET,POST,PATCH,DELETE,OPTIONS",
		AllowHeaders:     "Content-Type,Authorization",
		AllowCredentials: false,
	}))

	// WebSocket endpoint
	app.Use("/ws", func(c *fiber.Ctx) error {
		if websocket.IsWebSocketUpgrade(c) {
			return c.Next()
		}
		return fiber.ErrUpgradeRequired
	})
	app.Get("/ws", websocket.New(hub.HandleWS))

	// Register all REST routes
	api.RegisterRoutes(app, queries, aiClient, scraperClient, evolutionClient, sendgridClient, asynqClient, hub, cfg)

	// Health endpoint
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok"})
	})

	// ─── Graceful shutdown ────────────────────────────────────────────────────
	var wg sync.WaitGroup
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	wg.Add(1)
	go func() {
		defer wg.Done()
		<-quit
		slog.Info("Shutting down API server...")
		if err := app.Shutdown(); err != nil {
			slog.Error("Server shutdown error", "error", err)
		}
	}()

	slog.Info("API server starting", "port", 3000)
	if err := app.Listen(":3000"); err != nil {
		slog.Error("Server error", "error", err)
	}
	wg.Wait()
}
