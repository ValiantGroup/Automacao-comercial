package outreach

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/valyala/fasthttp"
)

// EvolutionClient sends WhatsApp messages via the Evolution API.
type EvolutionClient struct {
	baseURL    string
	apiKey     string
	instance   string
	httpClient *fasthttp.Client
}

func NewEvolutionClient(baseURL, apiKey, instance string) *EvolutionClient {
	if instance == "" {
		instance = "valiant"
	}
	return &EvolutionClient{
		baseURL:  baseURL,
		apiKey:   apiKey,
		instance: instance,
		httpClient: &fasthttp.Client{
			ReadTimeout:         30 * time.Second,
			WriteTimeout:        30 * time.Second,
			MaxIdleConnDuration: 60 * time.Second,
			MaxConnsPerHost:     20,
		},
	}
}

type sendTextRequest struct {
	Number  string `json:"number"`
	Text    string `json:"text"`
	Delay   int    `json:"delay"`
}

type sendTextResponse struct {
	Key struct {
		ID string `json:"id"`
	} `json:"key"`
	Error *string `json:"error,omitempty"`
}

// SendText sends a WhatsApp text message to the given phone number.
// phone should be in international format without +, e.g. "5511999990000".
func (e *EvolutionClient) SendText(ctx context.Context, phone, message string) (string, error) {
	reqBody := sendTextRequest{
		Number: phone,
		Text:   message,
		Delay:  1000,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("marshal request: %w", err)
	}
	url := fmt.Sprintf("%s/message/sendText/%s", e.baseURL, e.instance)

	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("request canceled: %w", err)
	}

	req := fasthttp.AcquireRequest()
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req)
	defer fasthttp.ReleaseResponse(resp)

	req.SetRequestURI(url)
	req.Header.SetMethod(fasthttp.MethodPost)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", e.apiKey)
	req.SetBodyRaw(bytes.Clone(body))

	err = e.httpClient.DoTimeout(req, resp, 30*time.Second)
	if err != nil {
		return "", fmt.Errorf("evolution send: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return "", fmt.Errorf("request canceled: %w", err)
	}

	respBody := bytes.Clone(resp.Body())

	if resp.StatusCode() >= fasthttp.StatusBadRequest {
		return "", fmt.Errorf("evolution API error %d: %s", resp.StatusCode(), string(respBody))
	}

	var result sendTextResponse
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("unmarshal evolution response: %w", err)
	}

	if result.Error != nil {
		return "", fmt.Errorf("evolution error: %s", *result.Error)
	}

	return result.Key.ID, nil
}
