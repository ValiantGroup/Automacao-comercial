package scraper

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client talks to the playwright-svc Node.js microservice.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
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
	body, _ := json.Marshal(map[string]string{"url": url})
	if err := c.post(ctx, "/scrape/website", body, &result); err != nil {
		return result, fmt.Errorf("scrape website %s: %w", url, err)
	}
	return result, nil
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
	body, _ := json.Marshal(map[string]string{"company_name": companyName})
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
	body, _ := json.Marshal(map[string]interface{}{"query": query, "limit": limit})
	if err := c.post(ctx, "/scrape/google-search", body, &result); err != nil {
		return result, fmt.Errorf("google search %q: %w", query, err)
	}
	return result, nil
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

func (c *Client) post(ctx context.Context, path string, body []byte, out interface{}) error {
	req, err := http.NewRequestWithContext(ctx, "POST", c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("playwright-svc %s: status %d — %s", path, resp.StatusCode, string(b))
	}

	return json.NewDecoder(resp.Body).Decode(out)
}
