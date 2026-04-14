package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"log/slog"
	"os"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/worker"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	limit := flag.Int("limit", 0, "maximum number of companies to enqueue (0 = all)")
	offset := flag.Int("offset", 0, "start offset")
	batchSize := flag.Int("batch-size", 200, "pagination batch size")
	dryRun := flag.Bool("dry-run", false, "print what would be enqueued without sending tasks")
	flag.Parse()

	if *batchSize <= 0 {
		*batchSize = 200
	}
	if *offset < 0 {
		*offset = 0
	}

	cfg := config.Load()
	ctx := context.Background()

	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		slog.Error("Parse PostgreSQL config failed", "error", err)
		os.Exit(1)
	}
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		slog.Error("Connect PostgreSQL failed", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	queries := db.NewPool(pool)

	redisOpts, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		slog.Error("Parse Redis URL failed", "error", err)
		os.Exit(1)
	}

	asynqRedisOpt := asynq.RedisClientOpt{Addr: redisOpts.Addr}
	asynqClient := asynq.NewClient(asynqRedisOpt)
	defer asynqClient.Close()

	currentOffset := *offset
	seen := 0
	enqueued := 0
	duplicates := 0
	failed := 0

	slog.Info("Starting web reprocess enqueue",
		"limit", *limit,
		"offset", *offset,
		"batch_size", *batchSize,
		"dry_run", *dryRun,
	)

	for {
		remaining := *batchSize
		if *limit > 0 {
			left := *limit - seen
			if left <= 0 {
				break
			}
			if left < remaining {
				remaining = left
			}
		}

		companies, err := queries.ListCompanies(ctx, int32(remaining), int32(currentOffset))
		if err != nil {
			slog.Error("List companies failed", "offset", currentOffset, "error", err)
			os.Exit(1)
		}
		if len(companies) == 0 {
			break
		}

		for _, company := range companies {
			seen++

			payload, err := json.Marshal(map[string]string{
				"company_id":  company.ID.String(),
				"campaign_id": "",
			})
			if err != nil {
				failed++
				slog.Error("Marshal web payload failed", "company_id", company.ID, "error", err)
				continue
			}

			if *dryRun {
				slog.Info("Dry-run web reprocess", "company_id", company.ID, "name", company.Name)
				continue
			}

			_, err = asynqClient.Enqueue(
				asynq.NewTask(worker.TaskEnrichWeb, payload),
				asynq.MaxRetry(3),
				asynq.Queue("enrichment"),
				asynq.Unique(30*time.Second),
			)
			if err != nil {
				if errors.Is(err, asynq.ErrDuplicateTask) {
					duplicates++
					continue
				}
				failed++
				slog.Error("Enqueue web reprocess failed", "company_id", company.ID, "error", err)
				continue
			}

			enqueued++
		}

		currentOffset += len(companies)
		if len(companies) < remaining {
			break
		}
	}

	slog.Info("Web reprocess enqueue complete",
		"seen", seen,
		"enqueued", enqueued,
		"duplicates", duplicates,
		"failed", failed,
		"dry_run", *dryRun,
	)
}
