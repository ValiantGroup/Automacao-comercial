package config

import (
	"log/slog"
	"os"
)

// Config holds all application configuration loaded from environment variables.
type Config struct {
	// Database
	DatabaseURL string

	// Redis
	RedisURL string

	// Auth
	JWTSecret string
	CORSAllowedOrigins string

	// OpenAI
	OpenAIAPIKey string

	// Google Maps
	GoogleMapsAPIKey string

	// LinkedIn
	LinkedInClientID     string
	LinkedInClientSecret string

	// Apollo.io (LinkedIn fallback)
	ApolloAPIKey string

	// Hunter.io (email finder)
	HunterAPIKey string

	// Evolution API (WhatsApp)
	EvolutionAPIURL string
	EvolutionAPIKey string

	// SendGrid (Email)
	SendGridAPIKey    string
	SendGridFromEmail string

	// Playwright scraping service
	PlaywrightSvcURL string

	// MinIO / S3
	MinIOEndpoint  string
	MinIOAccessKey string
	MinIOSecretKey string
}

// Load reads environment variables and returns a populated Config.
// Critical variables must be provided at startup.
func Load() *Config {
	cfg := &Config{
		DatabaseURL:          getEnv("DATABASE_URL", ""),
		RedisURL:             getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:            getEnv("JWT_SECRET", ""),
		CORSAllowedOrigins:   getEnv("CORS_ALLOWED_ORIGINS", "http://localhost:3001"),
		OpenAIAPIKey:         getEnv("OPENAI_API_KEY", ""),
		GoogleMapsAPIKey:     getEnv("GOOGLE_MAPS_API_KEY", ""),
		LinkedInClientID:     getEnv("LINKEDIN_CLIENT_ID", ""),
		LinkedInClientSecret: getEnv("LINKEDIN_CLIENT_SECRET", ""),
		ApolloAPIKey:         getEnv("APOLLO_API_KEY", ""),
		HunterAPIKey:         getEnv("HUNTER_API_KEY", ""),
		EvolutionAPIURL:      getEnv("EVOLUTION_API_URL", "http://localhost:8081"),
		EvolutionAPIKey:      getEnv("EVOLUTION_API_KEY", ""),
		SendGridAPIKey:       getEnv("SENDGRID_API_KEY", ""),
		SendGridFromEmail:    getEnv("SENDGRID_FROM_EMAIL", ""),
		PlaywrightSvcURL:     getEnv("PLAYWRIGHT_SVC_URL", "http://localhost:3002"),
		MinIOEndpoint:        getEnv("MINIO_ENDPOINT", ""),
		MinIOAccessKey:       getEnv("MINIO_ACCESS_KEY", ""),
		MinIOSecretKey:       getEnv("MINIO_SECRET_KEY", ""),
	}

	if cfg.DatabaseURL == "" {
		slog.Error("DATABASE_URL is required")
		os.Exit(1)
	}
	if cfg.JWTSecret == "" {
		slog.Error("JWT_SECRET is required")
		os.Exit(1)
	}
	if cfg.MinIOEndpoint == "" || cfg.MinIOAccessKey == "" || cfg.MinIOSecretKey == "" {
		slog.Error("MINIO_ENDPOINT, MINIO_ACCESS_KEY and MINIO_SECRET_KEY are required")
		os.Exit(1)
	}
	if cfg.OpenAIAPIKey == "" {
		slog.Warn("OPENAI_API_KEY not set — AI features will fail")
	}
	if cfg.GoogleMapsAPIKey == "" {
		slog.Warn("GOOGLE_MAPS_API_KEY not set — prospecting will fail")
	}

	return cfg
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
