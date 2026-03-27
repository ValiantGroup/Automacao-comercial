package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/valyala/fasthttp"
	"golang.org/x/time/rate"

	db "github.com/valiant-group/prospector/internal/db/generated"
)

type apolloStakeholderProvider struct {
	apiKey     string
	httpClient *fasthttp.Client
	limiter    *rate.Limiter
}

func newApolloStakeholderProvider(apiKey string) StakeholderProvider {
	return &apolloStakeholderProvider{
		apiKey: apiKey,
		httpClient: &fasthttp.Client{
			ReadTimeout:         30 * time.Second,
			WriteTimeout:        30 * time.Second,
			MaxIdleConnDuration: 60 * time.Second,
			MaxConnsPerHost:     20,
		},
		limiter: rate.NewLimiter(rate.Every(time.Second/2), 1), // free-tier friendly
	}
}

func (p *apolloStakeholderProvider) Name() string {
	return "apollo"
}

func (p *apolloStakeholderProvider) Find(ctx context.Context, company db.Company) ([]StakeholderCandidate, error) {
	if err := p.limiter.Wait(ctx); err != nil {
		return nil, err
	}

	domain := ""
	if company.Website != nil {
		domain = extractDomain(*company.Website)
	}

	payload := map[string]interface{}{
		"q_organization_domains_list": []string{domain},
		"person_titles": []string{
			"CEO", "CTO", "COO", "CFO",
			"Head Comercial", "Head de Vendas", "Head de TI",
			"Diretor", "Director", "VP",
		},
		"page":     1,
		"per_page": 10,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal apollo payload: %w", err)
	}

	req := fasthttp.AcquireRequest()
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req)
	defer fasthttp.ReleaseResponse(resp)

	req.SetRequestURI("https://api.apollo.io/api/v1/mixed_people/api_search")
	req.Header.SetMethod(fasthttp.MethodPost)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("accept", "application/json")
	req.Header.Set("Cache-Control", "no-cache")
	req.Header.Set("x-api-key", p.apiKey)
	req.SetBodyRaw(bytes.Clone(body))

	if err := p.httpClient.DoTimeout(req, resp, 30*time.Second); err != nil {
		return nil, fmt.Errorf("apollo request: %w", err)
	}

	if resp.StatusCode() >= fasthttp.StatusBadRequest {
		return nil, fmt.Errorf("apollo API error %d: %s", resp.StatusCode(), string(resp.Body()))
	}

	var result struct {
		People []struct {
			FirstName          string  `json:"first_name"`
			LastNameObfuscated string  `json:"last_name_obfuscated"`
			Title              *string `json:"title"`
		} `json:"people"`
	}
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, fmt.Errorf("decode apollo response: %w", err)
	}

	candidates := make([]StakeholderCandidate, 0, len(result.People))
	for _, person := range result.People {
		name := strings.TrimSpace(person.FirstName + " " + person.LastNameObfuscated)
		if name == "" {
			continue
		}
		candidates = append(candidates, StakeholderCandidate{
			Name:     name,
			RawTitle: strIfNotEmpty(strings.TrimSpace(ptrToString(person.Title))),
			Source:   "apollo",
		})
	}

	return candidates, nil
}

func ptrToString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}
