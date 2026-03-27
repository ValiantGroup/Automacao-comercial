package worker

import (
	"context"
	"fmt"
	"strings"

	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
)

// StakeholderCandidate is the normalized output produced by any provider.
type StakeholderCandidate struct {
	Name     string
	RawTitle *string
	Email    *string
	Phone    *string
	Source   string
}

// StakeholderProvider defines the contract for stakeholder enrichment providers.
type StakeholderProvider interface {
	Name() string
	Find(ctx context.Context, company db.Company) ([]StakeholderCandidate, error)
}

type stakeholderProviderRegistry struct {
	providers []StakeholderProvider
}

func newStakeholderProviderRegistry(cfg *config.Config) *stakeholderProviderRegistry {
	providers := make([]StakeholderProvider, 0, 2)

	if cfg.ApolloAPIKey != "" {
		providers = append(providers, newApolloStakeholderProvider(cfg.ApolloAPIKey))
	}
	if cfg.HunterAPIKey != "" {
		providers = append(providers, newHunterStakeholderProvider(cfg.HunterAPIKey))
	}

	return &stakeholderProviderRegistry{providers: providers}
}

func (r *stakeholderProviderRegistry) FindWithFallback(ctx context.Context, company db.Company) ([]StakeholderCandidate, string, error) {
	if len(r.providers) == 0 {
		return nil, "", nil
	}

	errs := make([]string, 0, len(r.providers))
	for _, provider := range r.providers {
		candidates, err := provider.Find(ctx, company)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s: %v", provider.Name(), err))
			continue
		}
		if len(candidates) > 0 {
			return candidates, provider.Name(), nil
		}
	}

	if len(errs) > 0 {
		return nil, "", fmt.Errorf("no stakeholder provider succeeded: %s", strings.Join(errs, " | "))
	}

	return nil, "", nil
}

func extractDomain(website string) string {
	website = strings.TrimPrefix(website, "https://")
	website = strings.TrimPrefix(website, "http://")
	website = strings.TrimPrefix(website, "www.")
	if idx := strings.Index(website, "/"); idx >= 0 {
		website = website[:idx]
	}
	return website
}
