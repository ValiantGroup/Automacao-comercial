package worker

import (
	"context"
	"fmt"
	"strings"
	"time"

	"golang.org/x/time/rate"

	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/hunter"
)

type hunterStakeholderProvider struct {
	client  *hunter.Client
	limiter *rate.Limiter
}

func newHunterStakeholderProvider(apiKey string) StakeholderProvider {
	return &hunterStakeholderProvider{
		client:  hunter.NewClient(apiKey),
		limiter: rate.NewLimiter(rate.Every(time.Second), 1), // free-tier friendly
	}
}

func (p *hunterStakeholderProvider) Name() string {
	return "hunter"
}

func (p *hunterStakeholderProvider) Find(ctx context.Context, company db.Company) ([]StakeholderCandidate, error) {
	if company.Website == nil || *company.Website == "" {
		return nil, nil
	}
	if err := p.limiter.Wait(ctx); err != nil {
		return nil, err
	}

	domain := extractDomain(*company.Website)
	if domain == "" {
		return nil, nil
	}

	resp, err := p.client.DomainSearch(ctx, domain)
	if err != nil {
		return nil, fmt.Errorf("hunter API failed: %w", err)
	}

	candidates := make([]StakeholderCandidate, 0, len(resp.Data.Emails))
	for _, email := range resp.Data.Emails {
		if email.Confidence < 50 && email.Type != "personal" {
			continue
		}

		name := strings.TrimSpace(email.FirstName + " " + email.LastName)
		if name == "" {
			name = "Unknown Contact"
		}

		candidates = append(candidates, StakeholderCandidate{
			Name:     name,
			RawTitle: strIfNotEmpty(strings.TrimSpace(email.Position)),
			Email:    strIfNotEmpty(strings.TrimSpace(email.Value)),
			Source:   "hunter",
		})
	}

	return candidates, nil
}
