FROM golang:1.22-alpine AS base
WORKDIR /app
RUN apk add --no-cache git curl
COPY go.mod go.sum ./
RUN go mod download
COPY . .

# ─── API binary ───────────────────────────────────────────────────────────────
FROM base AS api
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/api ./cmd/api
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:3000/health || exit 1
CMD ["/bin/api"]

# ─── Worker binary ────────────────────────────────────────────────────────────
FROM base AS worker
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /bin/worker ./cmd/worker
CMD ["/bin/worker"]

# ─── Migration runner ─────────────────────────────────────────────────────────
FROM base AS migrate
RUN go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.17.1
CMD migrate -path ./migrations -database "$DATABASE_URL" up
