package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	db "github.com/valiant-group/prospector/internal/db/generated"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	adminName := strings.TrimSpace(os.Getenv("ADMIN_NAME"))
	adminEmail := strings.TrimSpace(os.Getenv("ADMIN_EMAIL"))
	adminPassword := strings.TrimSpace(os.Getenv("ADMIN_PASSWORD"))

	if databaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	if adminName == "" || adminEmail == "" || adminPassword == "" {
		slog.Error("ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD are required")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		slog.Error("connect PostgreSQL failed", "err", err)
		os.Exit(1)
	}
	defer pool.Close()

	queries := db.NewPool(pool)

	if _, err := queries.GetUserByEmail(ctx, adminEmail); err == nil {
		slog.Info("admin user already exists", "email", adminEmail)
		return
	} else if err != pgx.ErrNoRows {
		slog.Error("failed to check existing admin", "err", err)
		os.Exit(1)
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(adminPassword), bcrypt.DefaultCost)
	if err != nil {
		slog.Error("failed to hash password", "err", err)
		os.Exit(1)
	}

	user, err := queries.CreateUser(ctx, adminName, adminEmail, string(hash), "admin")
	if err != nil {
		slog.Error("failed to create admin user", "err", err)
		os.Exit(1)
	}

	slog.Info("admin user created", "id", user.ID, "email", adminEmail)
	fmt.Println("seed-admin completed")
}
