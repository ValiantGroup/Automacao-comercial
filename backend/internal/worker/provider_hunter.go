package worker

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"

	db "github.com/valiant-group/prospector/internal/db/generated"
	"github.com/valiant-group/prospector/internal/hunter"
)

const hunterQuotaCooldown = 6 * time.Hour

type hunterStakeholderProvider struct {
	client  *hunter.Client
	limiter *rate.Limiter

	quotaMu            sync.RWMutex
	quotaExceededUntil time.Time
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
	if p.isQuotaTemporarilyExceeded(time.Now()) {
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
		if isHunterQuotaError(err) {
			p.markQuotaExceeded(time.Now())
			return nil, nil
		}
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

		rawTitle := strings.TrimSpace(email.Position)
		if rawTitle == "" {
			rawTitle = strings.TrimSpace(email.Department)
		}

		candidates = append(candidates, StakeholderCandidate{
			Name:     name,
			RawTitle: strIfNotEmpty(rawTitle),
			Email:    strIfNotEmpty(strings.TrimSpace(email.Value)),
			Source:   "hunter",
		})
	}

	return candidates, nil
}

func (p *hunterStakeholderProvider) isQuotaTemporarilyExceeded(now time.Time) bool {
	p.quotaMu.RLock()
	defer p.quotaMu.RUnlock()
	return p.quotaExceededUntil.After(now)
}

func (p *hunterStakeholderProvider) markQuotaExceeded(now time.Time) {
	p.quotaMu.Lock()
	alreadyBlocked := p.quotaExceededUntil.After(now)
	if !alreadyBlocked {
		p.quotaExceededUntil = now.Add(hunterQuotaCooldown)
	}
	p.quotaMu.Unlock()

	if !alreadyBlocked {
		slog.Warn(
			"Hunter quota reached; temporarily disabling provider",
			"cooldown_minutes", int(hunterQuotaCooldown/time.Minute),
		)
	}
}

func isHunterQuotaError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "too_many_requests") ||
		strings.Contains(msg, "rate limit") ||
		strings.Contains(msg, "usage limit") ||
		strings.Contains(msg, "error 429") ||
		strings.Contains(msg, "api 429")
}
