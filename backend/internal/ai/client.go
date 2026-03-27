package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/valyala/fasthttp"
)

const (
	openAIBaseURL = "https://api.openai.com/v1"
	modelGPT4o    = "gpt-4o"
	modelEmbed    = "text-embedding-3-small"
)

// Client wraps the OpenAI API.
type Client struct {
	apiKey     string
	httpClient *fasthttp.Client
}

// NewClient creates a new OpenAI client.
func NewClient(apiKey string) *Client {
	return &Client{
		apiKey: apiKey,
		httpClient: &fasthttp.Client{
			ReadTimeout:         90 * time.Second,
			WriteTimeout:        90 * time.Second,
			MaxIdleConnDuration: 90 * time.Second,
			MaxConnsPerHost:     50,
		},
	}
}

// ─── Chat Completion ──────────────────────────────────────────────────────────

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model          string        `json:"model"`
	Messages       []chatMessage `json:"messages"`
	ResponseFormat *struct {
		Type string `json:"type"`
	} `json:"response_format,omitempty"`
	Temperature float64 `json:"temperature"`
	MaxTokens   int     `json:"max_tokens"`
}

type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// Complete sends a prompt to GPT-4o and returns the raw string response.
func (c *Client) Complete(ctx context.Context, systemPrompt, userPrompt string) (string, error) {
	req := chatRequest{
		Model: modelGPT4o,
		Messages: []chatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
		ResponseFormat: &struct {
			Type string `json:"type"`
		}{Type: "json_object"},
		Temperature: 0.4,
		MaxTokens:   2000,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}

	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("request canceled: %w", err)
	}

	fasthttpReq := fasthttp.AcquireRequest()
	fasthttpResp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(fasthttpReq)
	defer fasthttp.ReleaseResponse(fasthttpResp)

	fasthttpReq.SetRequestURI(openAIBaseURL + "/chat/completions")
	fasthttpReq.Header.SetMethod(fasthttp.MethodPost)
	fasthttpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	fasthttpReq.Header.Set("Content-Type", "application/json")
	fasthttpReq.SetBodyRaw(bytes.Clone(body))

	err = c.httpClient.DoTimeout(fasthttpReq, fasthttpResp, 90*time.Second)
	if err != nil {
		return "", fmt.Errorf("openai request: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("request canceled: %w", err)
	}

	respBody := bytes.Clone(fasthttpResp.Body())
	if fasthttpResp.StatusCode() >= fasthttp.StatusBadRequest {
		return "", fmt.Errorf("openai request failed: status=%d body=%s", fasthttpResp.StatusCode(), string(respBody))
	}

	var chatResp chatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}

	if chatResp.Error != nil {
		return "", fmt.Errorf("openai error: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		return "", fmt.Errorf("openai returned no choices")
	}

	slog.Debug("OpenAI completion", "model", modelGPT4o, "response_len", len(chatResp.Choices[0].Message.Content))
	return chatResp.Choices[0].Message.Content, nil
}

// ─── Embeddings ───────────────────────────────────────────────────────────────

type embedRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

type embedResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// Embed generates a text embedding vector using text-embedding-3-small.
func (c *Client) Embed(ctx context.Context, text string) ([]float32, error) {
	req := embedRequest{
		Model: modelEmbed,
		Input: text,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal embed request: %w", err)
	}

	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("request canceled: %w", err)
	}

	fasthttpReq := fasthttp.AcquireRequest()
	fasthttpResp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(fasthttpReq)
	defer fasthttp.ReleaseResponse(fasthttpResp)

	fasthttpReq.SetRequestURI(openAIBaseURL + "/embeddings")
	fasthttpReq.Header.SetMethod(fasthttp.MethodPost)
	fasthttpReq.Header.Set("Authorization", "Bearer "+c.apiKey)
	fasthttpReq.Header.Set("Content-Type", "application/json")
	fasthttpReq.SetBodyRaw(bytes.Clone(body))

	err = c.httpClient.DoTimeout(fasthttpReq, fasthttpResp, 90*time.Second)
	if err != nil {
		return nil, fmt.Errorf("embed request: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("request canceled: %w", err)
	}

	respBody := bytes.Clone(fasthttpResp.Body())
	if fasthttpResp.StatusCode() >= fasthttp.StatusBadRequest {
		return nil, fmt.Errorf("openai embed request failed: status=%d body=%s", fasthttpResp.StatusCode(), string(respBody))
	}

	var embedResp embedResponse
	if err := json.Unmarshal(respBody, &embedResp); err != nil {
		return nil, fmt.Errorf("unmarshal embed response: %w", err)
	}

	if embedResp.Error != nil {
		return nil, fmt.Errorf("openai embed error: %s", embedResp.Error.Message)
	}

	if len(embedResp.Data) == 0 {
		return nil, fmt.Errorf("openai returned no embeddings")
	}

	return embedResp.Data[0].Embedding, nil
}
