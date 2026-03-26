.PHONY: up down build logs migrate shell-api shell-db restart-workers status ps

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build --no-cache

logs:
	docker compose logs -f api worker

migrate:
	docker compose run --rm migrate

shell-api:
	docker compose exec api sh

shell-db:
	docker compose exec postgres psql -U valiant valiant_prospector

restart-workers:
	docker compose restart worker

status:
	docker compose ps

ps:
	docker compose ps

# Generate sqlc code (requires sqlc installed locally)
sqlc:
	cd backend && sqlc generate

# Run local development (without Docker)
dev-api:
	cd backend && go run ./cmd/api

dev-worker:
	cd backend && go run ./cmd/worker

# Linting
lint:
	cd backend && golangci-lint run ./...
	cd frontend && npm run lint

# Tests
test-backend:
	cd backend && go test ./... -v

test-frontend:
	cd frontend && npm test
