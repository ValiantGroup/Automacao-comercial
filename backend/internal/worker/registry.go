package worker

import (
	"log/slog"

	"github.com/hibiken/asynq"

	"github.com/valiant-group/prospector/internal/ai"
	"github.com/valiant-group/prospector/internal/config"
	"github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/outreach"
	"github.com/valiant-group/prospector/internal/scraper"
)

// Task type constants used throughout the pipeline.
const (
	TaskProspect       = "prospect:search"
	TaskEnrichMaps     = "enrich:maps"
	TaskEnrichLinkedIn = "enrich:linkedin"
	TaskEnrichWeb      = "enrich:web"
	TaskAIAnalyze      = "ai:analyze"
	TaskAIGenerate     = "ai:generate"
	TaskOutreachSend   = "outreach:send"
)

// Registry builds and returns a configured Asynq ServeMux with all task handlers.
func Registry(
	cfg *config.Config,
	queries *db.Queries,
	aiClient *ai.Client,
	scraperClient *scraper.Client,
	evolutionClient *outreach.EvolutionClient,
	sendgridClient *outreach.SendGridClient,
	redisOpt asynq.RedisClientOpt,
	broadcaster func(eventType string, payload interface{}),
) *asynq.ServeMux {
	mux := asynq.NewServeMux()

	client := asynq.NewClient(redisOpt)

	mw := newMapsWorker(cfg, queries, client, broadcaster)
	lw := newLinkedInWorker(cfg, queries, aiClient, client)
	ww := newWebWorker(cfg, queries, scraperClient, client)
	aw := newAIWorker(cfg, queries, aiClient, client, broadcaster)
	ow := newOutreachWorker(cfg, queries, evolutionClient, sendgridClient, broadcaster)

	mux.HandleFunc(TaskProspect, mw.Handle)
	mux.HandleFunc(TaskEnrichLinkedIn, lw.Handle)
	mux.HandleFunc(TaskEnrichWeb, ww.Handle)
	mux.HandleFunc(TaskAIAnalyze, aw.Handle)
	mux.HandleFunc(TaskAIGenerate, aw.HandleGenerate)
	mux.HandleFunc(TaskOutreachSend, ow.Handle)

	slog.Info("Worker registry initialized",
		"tasks", []string{TaskProspect, TaskEnrichLinkedIn, TaskEnrichWeb, TaskAIAnalyze, TaskAIGenerate, TaskOutreachSend})

	return mux
}
