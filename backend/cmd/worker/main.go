package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/valiant-group/prospector/internal/ai"
	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/outreach"
	"github.com/valiant-group/prospector/internal/scraper"
	"github.com/valiant-group/prospector/internal/worker"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	cfg := config.Load()
	ctx := context.Background()

	// PostgreSQL
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("Connect PostgreSQL", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	// Redis
	redisOpts, _ := redis.ParseURL(cfg.RedisURL)
	asynqRedisOpt := asynq.RedisClientOpt{Addr: redisOpts.Addr}

	// Dependencies
	queries := db.NewPool(pool)
	aiClient := ai.NewClient(cfg.OpenAIAPIKey)
	scraperClient := scraper.NewClient(cfg.PlaywrightSvcURL)
	evolutionClient := outreach.NewEvolutionClient(cfg.EvolutionAPIURL, cfg.EvolutionAPIKey, "valiant")
	sendgridClient := outreach.NewSendGridClient(cfg.SendGridAPIKey, cfg.SendGridFromEmail)

	// Asynq client for enqueuing downstream tasks
	asynqClient := asynq.NewClient(asynqRedisOpt)
	defer asynqClient.Close()

	// Noop broadcaster for workers (actual broadcasts happen only from API process)
	broadcaster := func(eventType string, payload interface{}) {
		slog.Debug("Worker event", "type", eventType, "payload", payload)
	}

	// Build worker handler mux
	mux := worker.Registry(cfg, queries, aiClient, scraperClient, evolutionClient, sendgridClient, asynqRedisOpt, broadcaster)

	// Asynq server configuration
	srv := asynq.NewServer(asynqRedisOpt, asynq.Config{
		Concurrency: 5,
		Queues: map[string]int{
			"critical":   6,
			"ai":         3,
			"enrichment": 3,
			"default":    1,
		},
		ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
			slog.Error("Task error", "type", task.Type(), "error", err)
		}),
	})

	slog.Info("Worker server starting")

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-quit
		slog.Info("Shutting down worker...")
		srv.Shutdown()
	}()

	if err := srv.Run(mux); err != nil {
		slog.Error("Worker server error", "error", err)
		os.Exit(1)
	}
}
