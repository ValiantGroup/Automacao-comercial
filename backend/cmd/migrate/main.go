package main

import (
	"log/slog"
	"os"
)

// The migrate target in the Dockerfile runs the `migrate` CLI directly.
// This file exists so `go build ./cmd/migrate` succeeds inside the multi-stage build.
func main() {
	slog.Info("Running migrations via golang-migrate CLI...")
	// Actual migration is run via the CLI in the Dockerfile CMD:
	// migrate -path ./migrations -database $DATABASE_URL up
	os.Exit(0)
}
