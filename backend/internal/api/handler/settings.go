package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
)

const aiGlobalContextKey = "ai_global_context"

type SettingsHandler struct {
	queries    *db.Queries
	cfg        *config.Config
	httpClient *http.Client
}

func NewSettingsHandler(queries *db.Queries, cfg *config.Config) *SettingsHandler {
	return &SettingsHandler{
		queries: queries,
		cfg:     cfg,
		httpClient: &http.Client{
			Timeout: 6 * time.Second,
		},
	}
}

func (h *SettingsHandler) Get(c *fiber.Ctx) error {
	ctx := c.Context()
	setting, err := h.queries.GetSystemSetting(ctx, aiGlobalContextKey)
	contextText := strings.TrimSpace(h.cfg.AIGlobalContext)
	if err == nil {
		contextText = strings.TrimSpace(setting.ValueText)
	}

	return c.JSON(fiber.Map{
		"ai_global_context": contextText,
	})
}

func (h *SettingsHandler) Update(c *fiber.Ctx) error {
	var body struct {
		AIGlobalContext string `json:"ai_global_context"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	value := strings.TrimSpace(body.AIGlobalContext)
	if value == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ai_global_context is required"})
	}
	if len([]rune(value)) > 4000 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "ai_global_context too long"})
	}

	updated, err := h.queries.UpsertSystemSetting(c.Context(), aiGlobalContextKey, value)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to save settings"})
	}

	return c.JSON(fiber.Map{
		"ai_global_context": updated.ValueText,
		"updated_at":        updated.UpdatedAt,
	})
}

type integrationDiagnostic struct {
	Key        string    `json:"key"`
	Label      string    `json:"label"`
	Status     string    `json:"status"`
	Configured bool      `json:"configured"`
	Reachable  bool      `json:"reachable"`
	Detail     string    `json:"detail"`
	CheckedAt  time.Time `json:"checked_at"`
}

func (h *SettingsHandler) Diagnostics(c *fiber.Ctx) error {
	type checkFunc func(context.Context) integrationDiagnostic

	checks := []checkFunc{
		h.checkEvolution,
		h.checkOpenAI,
		h.checkGoogleMaps,
		h.checkSendGrid,
		h.checkApollo,
	}

	ctx, cancel := context.WithTimeout(c.Context(), 10*time.Second)
	defer cancel()

	results := make([]integrationDiagnostic, len(checks))
	var wg sync.WaitGroup
	for i, fn := range checks {
		wg.Add(1)
		go func(idx int, f checkFunc) {
			defer wg.Done()
			results[idx] = f(ctx)
		}(i, fn)
	}
	wg.Wait()

	return c.JSON(fiber.Map{"integrations": results})
}

func (h *SettingsHandler) checkEvolution(ctx context.Context) integrationDiagnostic {
	d := integrationDiagnostic{
		Key:       "evolution",
		Label:     "WhatsApp (Evolution API)",
		CheckedAt: time.Now().UTC(),
	}
	url := strings.TrimSpace(h.cfg.EvolutionAPIURL)
	apiKey := strings.TrimSpace(h.cfg.EvolutionAPIKey)
	if url == "" || apiKey == "" {
		d.Status = "missing_config"
		d.Detail = "EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes"
		return d
	}
	d.Configured = true

	statusCode, _, err := h.doRequest(ctx, http.MethodGet, strings.TrimRight(url, "/"), map[string]string{
		"apikey": apiKey,
	}, nil)
	if err != nil {
		d.Status = "unreachable"
		d.Detail = err.Error()
		return d
	}
	d.Reachable = true
	switch statusCode {
	case 200, 201, 202, 204:
		d.Status = "ok"
		d.Detail = fmt.Sprintf("HTTP %d", statusCode)
		return d
	case 401, 403:
		d.Status = "auth_error"
		d.Detail = fmt.Sprintf("HTTP %d", statusCode)
		return d
	}
	d.Status = "degraded"
	d.Detail = fmt.Sprintf("HTTP %d", statusCode)
	return d
}

func (h *SettingsHandler) checkOpenAI(ctx context.Context) integrationDiagnostic {
	model := strings.TrimSpace(h.cfg.OpenAIModel)
	label := "OpenAI"
	if model != "" {
		label = "OpenAI " + model
	}

	d := integrationDiagnostic{
		Key:       "openai",
		Label:     label,
		CheckedAt: time.Now().UTC(),
	}
	baseURL := strings.TrimRight(strings.TrimSpace(h.cfg.OpenAIBaseURL), "/")
	apiKey := strings.TrimSpace(h.cfg.OpenAIAPIKey)
	if baseURL == "" || apiKey == "" {
		d.Status = "missing_config"
		d.Detail = "OPENAI_BASE_URL/OPENAI_API_KEY ausentes"
		return d
	}
	d.Configured = true

	statusCode, _, err := h.doRequest(ctx, http.MethodGet, baseURL+"/models", map[string]string{
		"Authorization": "Bearer " + apiKey,
	}, nil)
	if err != nil {
		d.Status = "unreachable"
		d.Detail = err.Error()
		return d
	}
	d.Reachable = true
	switch statusCode {
	case 200:
		d.Status = "ok"
		d.Detail = "Credenciais validas"
	case 401, 403:
		d.Status = "auth_error"
		d.Detail = fmt.Sprintf("HTTP %d (credencial invalida ou sem permissao)", statusCode)
	default:
		d.Status = "degraded"
		d.Detail = fmt.Sprintf("HTTP %d", statusCode)
	}
	return d
}

func (h *SettingsHandler) checkGoogleMaps(ctx context.Context) integrationDiagnostic {
	d := integrationDiagnostic{
		Key:       "google_maps",
		Label:     "Google Maps API",
		CheckedAt: time.Now().UTC(),
	}
	apiKey := strings.TrimSpace(h.cfg.GoogleMapsAPIKey)
	if apiKey == "" {
		d.Status = "missing_config"
		d.Detail = "GOOGLE_MAPS_API_KEY ausente"
		return d
	}
	d.Configured = true

	url := "https://maps.googleapis.com/maps/api/geocode/json?address=Sao+Paulo&key=" + apiKey
	statusCode, body, err := h.doRequest(ctx, http.MethodGet, url, nil, nil)
	if err != nil {
		d.Status = "unreachable"
		d.Detail = err.Error()
		return d
	}
	d.Reachable = true
	if statusCode != 200 {
		d.Status = "degraded"
		d.Detail = fmt.Sprintf("HTTP %d", statusCode)
		return d
	}

	var payload struct {
		Status string `json:"status"`
	}
	_ = json.Unmarshal(body, &payload)

	switch strings.ToUpper(strings.TrimSpace(payload.Status)) {
	case "OK", "ZERO_RESULTS":
		d.Status = "ok"
		d.Detail = payload.Status
	case "REQUEST_DENIED", "INVALID_REQUEST":
		d.Status = "auth_error"
		d.Detail = payload.Status
	default:
		d.Status = "degraded"
		d.Detail = payload.Status
	}
	return d
}

func (h *SettingsHandler) checkSendGrid(ctx context.Context) integrationDiagnostic {
	d := integrationDiagnostic{
		Key:       "sendgrid",
		Label:     "SendGrid",
		CheckedAt: time.Now().UTC(),
	}
	apiKey := strings.TrimSpace(h.cfg.SendGridAPIKey)
	from := strings.TrimSpace(h.cfg.SendGridFromEmail)
	if apiKey == "" || from == "" {
		d.Status = "missing_config"
		d.Detail = "SENDGRID_API_KEY/SENDGRID_FROM_EMAIL ausentes"
		return d
	}
	d.Configured = true

	statusCode, _, err := h.doRequest(ctx, http.MethodGet, "https://api.sendgrid.com/v3/scopes", map[string]string{
		"Authorization": "Bearer " + apiKey,
	}, nil)
	if err != nil {
		d.Status = "unreachable"
		d.Detail = err.Error()
		return d
	}
	d.Reachable = true
	switch statusCode {
	case 200:
		d.Status = "ok"
		d.Detail = "Credenciais validas"
	case 401, 403:
		d.Status = "auth_error"
		d.Detail = fmt.Sprintf("HTTP %d", statusCode)
	default:
		d.Status = "degraded"
		d.Detail = fmt.Sprintf("HTTP %d", statusCode)
	}
	return d
}

func (h *SettingsHandler) checkApollo(ctx context.Context) integrationDiagnostic {
	d := integrationDiagnostic{
		Key:       "apollo",
		Label:     "Apollo.io",
		CheckedAt: time.Now().UTC(),
	}
	apiKey := strings.TrimSpace(h.cfg.ApolloAPIKey)
	if apiKey == "" {
		d.Status = "missing_config"
		d.Detail = "APOLLO_API_KEY ausente"
		return d
	}
	d.Configured = true

	payload := map[string]interface{}{
		"q_organization_domains_list": []string{"example.com"},
		"person_titles":               []string{"CEO"},
		"page":                        1,
		"per_page":                    1,
	}
	body, _ := json.Marshal(payload)

	statusCode, respBody, err := h.doRequest(ctx, http.MethodPost, "https://api.apollo.io/api/v1/mixed_people/api_search", map[string]string{
		"Content-Type":  "application/json",
		"accept":        "application/json",
		"Cache-Control": "no-cache",
		"x-api-key":     apiKey,
	}, body)
	if err != nil {
		d.Status = "unreachable"
		d.Detail = err.Error()
		return d
	}
	d.Reachable = true
	respText := strings.ToUpper(string(respBody))
	if statusCode == 200 {
		d.Status = "ok"
		d.Detail = "Credenciais validas"
		return d
	}
	if statusCode == 403 && strings.Contains(respText, "API_INACCESSIBLE") {
		d.Status = "restricted"
		d.Detail = "Plano atual sem acesso ao endpoint de pessoas"
		return d
	}
	if statusCode == 401 {
		d.Status = "auth_error"
		d.Detail = "Credencial invalida"
		return d
	}
	d.Status = "degraded"
	d.Detail = fmt.Sprintf("HTTP %d", statusCode)
	return d
}

func (h *SettingsHandler) doRequest(ctx context.Context, method, url string, headers map[string]string, body []byte) (int, []byte, error) {
	var reader io.Reader
	if len(body) > 0 {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return 0, nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := h.httpClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return resp.StatusCode, respBody, nil
}
