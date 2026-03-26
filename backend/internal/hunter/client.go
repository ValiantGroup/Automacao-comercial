package hunter

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"

	"github.com/valyala/fasthttp"
)

type Client struct {
	apiKey string
}

func NewClient(apiKey string) *Client {
	return &Client{apiKey: apiKey}
}

type DomainSearchResponse struct {
	Data struct {
		Domain       string `json:"domain"`
		Organization string `json:"organization"`
		Emails       []struct {
			Value      string `json:"value"`
			Type       string `json:"type"`
			Confidence int    `json:"confidence"`
			FirstName  string `json:"first_name"`
			LastName   string `json:"last_name"`
			Position   string `json:"position"`
			Department string `json:"department"`
		} `json:"emails"`
	} `json:"data"`
	Meta struct {
		Results int `json:"results"`
		Limit   int `json:"limit"`
		Offset  int `json:"offset"`
	} `json:"meta"`
}

type ErrorResponse struct {
	Errors []struct {
		ID      string `json:"id"`
		Code    int    `json:"code"`
		Details string `json:"details"`
	} `json:"errors"`
}

func (c *Client) DomainSearch(ctx context.Context, domain string) (*DomainSearchResponse, error) {
	reqURL := fmt.Sprintf("https://api.hunter.io/v2/domain-search?domain=%s", url.QueryEscape(domain))
	
	req := fasthttp.AcquireRequest()
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req)
	defer fasthttp.ReleaseResponse(resp)

	req.SetRequestURI(reqURL)
	req.Header.SetMethod(fasthttp.MethodGet)
	req.Header.Set("X-API-KEY", c.apiKey)
	req.Header.Set("Accept", "application/json")

	err := fasthttp.Do(req, resp)
	if err != nil {
		return nil, err
	}

	statusCode := resp.StatusCode()
	if statusCode >= 400 {
		return nil, c.parseError(resp)
	}

	var result DomainSearchResponse
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (c *Client) parseError(resp *fasthttp.Response) error {
	b := resp.Body()
	var errResp ErrorResponse
	
	if err := json.Unmarshal(b, &errResp); err == nil && len(errResp.Errors) > 0 {
		first := errResp.Errors[0]
		return fmt.Errorf("hunter API error %d (%s): %s", resp.StatusCode(), first.ID, first.Details)
	}

	switch resp.StatusCode() {
	case 400:
		return fmt.Errorf("hunter API 400 Bad request: Missing or invalid parameter: %s", string(b))
	case 401:
		return fmt.Errorf("hunter API 401 Unauthorized: No valid API key provided")
	case 403:
		return fmt.Errorf("hunter API 403 Forbidden: Rate limit reached or plan access denied")
	case 404:
		return fmt.Errorf("hunter API 404 Not found: Resource does not exist")
	case 422:
		return fmt.Errorf("hunter API 422 Unprocessable entity: Request is valid but failed: %s", string(b))
	case 429:
		return fmt.Errorf("hunter API 429 Too many requests: Usage limit reached")
	case 451:
		return fmt.Errorf("hunter API 451 Unavailable for legal reasons: Cannot process PII for this person")
	default:
		return fmt.Errorf("hunter API error %d: %s", resp.StatusCode(), string(b))
	}
}
