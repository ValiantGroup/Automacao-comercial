package scraper

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/valyala/fasthttp"
)

// Client talks to the playwright-svc Node.js microservice.
type Client struct {
	baseURL    string
	httpClient *fasthttp.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &fasthttp.Client{
			ReadTimeout:         60 * time.Second,
			WriteTimeout:        60 * time.Second,
			MaxIdleConnDuration: 60 * time.Second,
			MaxConnsPerHost:     30,
		},
	}
}

// ─── Website scrape ───────────────────────────────────────────────────────────

type WebsiteResult struct {
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	TextContent  string   `json:"text_content"`
	Technologies []string `json:"technologies"`
	Links        []string `json:"links"`
}

func (c *Client) ScrapeWebsite(ctx context.Context, url string) (WebsiteResult, error) {
	var result WebsiteResult
	candidates := normalizeWebsiteCandidates(url)
	if len(candidates) == 0 {
		return result, fmt.Errorf("scrape website: empty url")
	}

	var lastErr error
	for _, candidate := range candidates {
		body, err := json.Marshal(map[string]string{"url": candidate})
		if err != nil {
			return result, fmt.Errorf("marshal website payload: %w", err)
		}
		if err := c.post(ctx, "/scrape/website", body, &result); err == nil {
			return result, nil
		} else {
			lastErr = err
		}
	}

	return result, fmt.Errorf("scrape website %s: %w", url, lastErr)
}

// ─── Reclame Aqui ─────────────────────────────────────────────────────────────

type ReclameAquiResult struct {
	Found           bool    `json:"found"`
	Score           float32 `json:"score"`
	SolutionRate    float32 `json:"solution_rate"`
	ComplaintsCount int     `json:"complaints_count"`
	Summary         string  `json:"summary"`
}

func (c *Client) ScrapeReclameAqui(ctx context.Context, companyName string) (ReclameAquiResult, error) {
	var result ReclameAquiResult
	body, err := json.Marshal(map[string]string{"company_name": companyName})
	if err != nil {
		return result, fmt.Errorf("marshal reclame aqui payload: %w", err)
	}
	if err := c.post(ctx, "/scrape/reclame-aqui", body, &result); err != nil {
		return result, fmt.Errorf("scrape reclame aqui %s: %w", companyName, err)
	}
	return result, nil
}

// ─── Google search ────────────────────────────────────────────────────────────

type SearchResult struct {
	Title   string `json:"title"`
	URL     string `json:"url"`
	Snippet string `json:"snippet"`
}

type GoogleSearchResult struct {
	Results []SearchResult `json:"results"`
}

func (c *Client) GoogleSearch(ctx context.Context, query string, limit int) (GoogleSearchResult, error) {
	var result GoogleSearchResult
	body, err := json.Marshal(map[string]interface{}{"query": query, "limit": limit})
	if err != nil {
		return result, fmt.Errorf("marshal google search payload: %w", err)
	}
	if err := c.post(ctx, "/scrape/google-search", body, &result); err != nil {
		return result, fmt.Errorf("google search %q: %w", query, err)
	}
	return result, nil
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

func (c *Client) post(ctx context.Context, path string, body []byte, out interface{}) error {
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("request canceled: %w", err)
	}

	req := fasthttp.AcquireRequest()
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req)
	defer fasthttp.ReleaseResponse(resp)

	req.SetRequestURI(c.baseURL + path)
	req.Header.SetMethod(fasthttp.MethodPost)
	req.Header.Set("Content-Type", "application/json")
	req.SetBodyRaw(bytes.Clone(body))

	const maxAttempts = 2
	var err error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		err = c.httpClient.DoTimeout(req, resp, 60*time.Second)
		if err == nil {
			break
		}
		if err := ctx.Err(); err != nil {
			return fmt.Errorf("request canceled: %w", err)
		}
		if attempt == maxAttempts || !isTransientPlaywrightSvcTransportError(err) {
			return err
		}
		time.Sleep(150 * time.Millisecond)
		resp.Reset()
	}
	if err := ctx.Err(); err != nil {
		return fmt.Errorf("request canceled: %w", err)
	}

	if resp.StatusCode() >= fasthttp.StatusBadRequest {
		return fmt.Errorf("playwright-svc %s: status %d - %s", path, resp.StatusCode(), string(resp.Body()))
	}

	return json.Unmarshal(resp.Body(), out)
}

func isTransientPlaywrightSvcTransportError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return (
		strings.Contains(msg, "server closed connection before returning the first response byte") ||
			strings.Contains(msg, "connection reset by peer") ||
			strings.Contains(msg, "broken pipe") ||
			strings.Contains(msg, "i/o timeout") ||
			strings.Contains(msg, "connection refused")
	)
}

func normalizeWebsiteCandidates(raw string) []string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}

	seen := map[string]bool{}
	appendUnique := func(v string, out *[]string) {
		if v == "" || seen[v] {
			return
		}
		seen[v] = true
		*out = append(*out, v)
	}

	result := make([]string, 0, 3)
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		appendUnique(raw, &result)
		if strings.HasPrefix(raw, "https://") {
			appendUnique("http://"+strings.TrimPrefix(raw, "https://"), &result)
		}
		if strings.HasPrefix(raw, "http://") {
			appendUnique("https://"+strings.TrimPrefix(raw, "http://"), &result)
		}
		return result
	}

	appendUnique("https://"+raw, &result)
	appendUnique("http://"+raw, &result)
	return result
}

