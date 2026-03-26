package outreach

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// EvolutionClient sends WhatsApp messages via the Evolution API.
type EvolutionClient struct {
	baseURL    string
	apiKey     string
	instance   string
	httpClient *http.Client
}

func NewEvolutionClient(baseURL, apiKey, instance string) *EvolutionClient {
	if instance == "" {
		instance = "valiant"
	}
	return &EvolutionClient{
		baseURL:  baseURL,
		apiKey:   apiKey,
		instance: instance,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
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

	body, _ := json.Marshal(reqBody)
	url := fmt.Sprintf("%s/message/sendText/%s", e.baseURL, e.instance)

	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", e.apiKey)

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("evolution send: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode >= 400 {
		return "", fmt.Errorf("evolution API error %d: %s", resp.StatusCode, string(respBody))
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
