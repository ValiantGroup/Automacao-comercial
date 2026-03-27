package worker

import (
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strings"

	"github.com/valiant-group/prospector/internal/ai"
	db "github.com/valiant-group/prospector/internal/db/generated"
)

type analysisEvidence struct {
	WebsiteURL         string
	WebsiteHost        string
	HasWebsite         bool
	HasCorporateSite   bool
	HasWebsiteDesc     bool
	TechStack          []string
	OpenJobs           []string
	StakeholderCount   int
	StakeholderRoles   []string
	ReputationScore    *float32
	ReputationSummary  string
	GoogleRating       *float32
	GoogleReviewsCount *int32
}

func buildDeterministicAnalysis(company db.Company, intel db.CompanyIntelligence, stakeholders []db.Stakeholder) ai.AnalysisResult {
	ev := extractEvidence(company, intel, stakeholders)

	painPoints := buildEvidencePainPoints(ev)
	fitScore := computeDeterministicFitScore(ev)
	fitJustification := buildFitJustification(ev, fitScore)
	personaPriority, personaJustification := choosePersona(ev)
	summary := buildSummary(company, ev)

	return ai.AnalysisResult{
		Summary:              summary,
		PainPoints:           painPoints,
		FitScore:             fitScore,
		FitJustification:     fitJustification,
		TechStack:            ev.TechStack,
		PersonaPriority:      personaPriority,
		PersonaJustification: personaJustification,
	}
}

func extractEvidence(company db.Company, intel db.CompanyIntelligence, stakeholders []db.Stakeholder) analysisEvidence {
	tech := parseJSONStringArray(intel.TechStack)
	openJobs := parseJSONStringArray(intel.OpenJobs)
	websiteURL := strings.TrimSpace(ptrToString(company.Website))
	host := extractHost(websiteURL)
	hasCorporateSite := host != "" && !isSocialOrAggregatorHost(host)

	roleSet := make([]string, 0, len(stakeholders))
	seen := map[string]bool{}
	for _, s := range stakeholders {
		role := strings.TrimSpace(strings.ToUpper(ptrToString(s.NormalizedRole)))
		if role == "" || seen[role] {
			continue
		}
		seen[role] = true
		roleSet = append(roleSet, role)
	}

	return analysisEvidence{
		WebsiteURL:         websiteURL,
		WebsiteHost:        host,
		HasWebsite:         websiteURL != "",
		HasCorporateSite:   hasCorporateSite,
		HasWebsiteDesc:     strings.TrimSpace(ptrToString(intel.WebsiteDescription)) != "",
		TechStack:          tech,
		OpenJobs:           openJobs,
		StakeholderCount:   len(stakeholders),
		StakeholderRoles:   roleSet,
		ReputationScore:    intel.ReputationScore,
		ReputationSummary:  strings.TrimSpace(ptrToString(intel.ReputationSummary)),
		GoogleRating:       company.GoogleRating,
		GoogleReviewsCount: company.GoogleReviewsCount,
	}
}

func buildSummary(company db.Company, ev analysisEvidence) string {
	niche := strings.TrimSpace(ptrToString(company.Niche))
	if niche == "" {
		niche = "nao informado"
	}
	location := strings.TrimSpace(ptrToString(company.City))
	if location == "" {
		location = "nao informada"
	}

	websiteStatus := "website nao informado"
	if ev.HasCorporateSite {
		websiteStatus = "site institucional identificado"
	} else if ev.HasWebsite {
		websiteStatus = "website em host social/agregador"
	}

	reputation := "reputacao externa nao validada"
	if ev.ReputationScore != nil {
		reputation = fmt.Sprintf("reputacao %.1f/10", *ev.ReputationScore)
	}

	return fmt.Sprintf(
		"%s atua no nicho %s em %s. Evidencias coletadas: %s, %d stakeholders mapeados, %d tecnologias detectadas e %s.",
		company.Name, niche, location, websiteStatus, ev.StakeholderCount, len(ev.TechStack), reputation,
	)
}

func buildEvidencePainPoints(ev analysisEvidence) []string {
	pains := make([]string, 0, 6)

	if !ev.HasCorporateSite {
		if ev.HasWebsite {
			pains = append(pains, "Nao foi validado site institucional proprio; apenas host social/agregador.")
		} else {
			pains = append(pains, "Nao foi encontrado website publico validavel.")
		}
	}

	if len(ev.TechStack) == 0 {
		pains = append(pains, "Nao foi identificada stack tecnologica publica.")
	}

	if ev.StakeholderCount == 0 {
		pains = append(pains, "Nao ha stakeholders com contato validado.")
	}

	if ev.ReputationScore == nil {
		pains = append(pains, "Nao foi possivel validar reputacao externa.")
	} else if *ev.ReputationScore < 7 {
		pains = append(pains, fmt.Sprintf("Reputacao publica abaixo de 7/10 (%.1f).", *ev.ReputationScore))
	}

	if len(ev.OpenJobs) > 0 {
		pains = append(pains, fmt.Sprintf("Foram identificadas %d vagas abertas.", len(ev.OpenJobs)))
	}

	if len(pains) == 0 {
		pains = append(pains, "Evidencias insuficientes para apontar dores especificas.")
	}

	return pains
}

func computeDeterministicFitScore(ev analysisEvidence) int {
	opportunity := 10
	if !ev.HasCorporateSite {
		opportunity += 25
	}
	if len(ev.TechStack) == 0 {
		opportunity += 20
	}
	if ev.StakeholderCount == 0 {
		opportunity += 10
	}
	if ev.ReputationScore != nil && *ev.ReputationScore < 7 {
		opportunity += 15
	}
	if len(ev.OpenJobs) > 0 {
		opportunity += 10
	}
	if ev.GoogleReviewsCount != nil && *ev.GoogleReviewsCount >= 200 {
		opportunity += 5
	}
	if ev.HasCorporateSite && len(ev.TechStack) > 0 {
		opportunity += 5
	}

	confidence := 20
	if ev.HasWebsiteDesc || ev.HasCorporateSite {
		confidence += 20
	}
	if len(ev.TechStack) > 0 {
		confidence += 20
	}
	if ev.ReputationScore != nil {
		confidence += 20
	}
	if ev.StakeholderCount > 0 {
		confidence += 20
	}
	if len(ev.OpenJobs) > 0 {
		confidence += 20
	}

	opportunity = clamp(opportunity, 0, 100)
	confidence = clamp(confidence, 0, 100)

	score := int(math.Round(float64(opportunity)*0.7 + float64(confidence)*0.3))
	maxByConfidence := clamp(confidence+10, 0, 100)
	if score > maxByConfidence {
		score = maxByConfidence
	}

	return clamp(score, 0, 100)
}

func buildFitJustification(ev analysisEvidence, fitScore int) string {
	website := "ausente"
	if ev.HasCorporateSite {
		website = "site institucional"
	} else if ev.HasWebsite {
		website = "host social/agregador"
	}

	reputation := "nao validada"
	if ev.ReputationScore != nil {
		reputation = fmt.Sprintf("%.1f/10", *ev.ReputationScore)
	}

	return fmt.Sprintf(
		"Score %d calculado por regras objetivas sobre evidencias coletadas: website (%s), stack (%d), stakeholders (%d), reputacao (%s), vagas (%d).",
		fitScore, website, len(ev.TechStack), ev.StakeholderCount, reputation, len(ev.OpenJobs),
	)
}

func choosePersona(ev analysisEvidence) (string, string) {
	priorityOrder := []string{"CEO", "CTO", "HEAD_COMERCIAL", "HEAD_ADM", "HEAD_TECH"}
	for _, role := range priorityOrder {
		if slices.Contains(ev.StakeholderRoles, role) {
			return normalizePersona(role), fmt.Sprintf("Persona priorizada com base em stakeholder identificado: %s.", role)
		}
	}

	if !ev.HasCorporateSite || len(ev.TechStack) == 0 {
		return "CEO", "Sem decisor mapeado, CEO priorizado para alinhamento estrategico."
	}
	if ev.ReputationScore != nil && *ev.ReputationScore < 7 {
		return "HEAD_ADM", "Reputacao abaixo de 7/10 sugere foco operacional."
	}
	return "HEAD_COMERCIAL", "Sem decisor explicito, area comercial priorizada para qualificacao."
}

func normalizePersona(role string) string {
	switch role {
	case "HEAD_TECH":
		return "CTO"
	default:
		return role
	}
}

func parseJSONStringArray(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var arr []string
	if err := json.Unmarshal(raw, &arr); err != nil {
		return nil
	}
	out := make([]string, 0, len(arr))
	seen := map[string]bool{}
	for _, item := range arr {
		item = strings.TrimSpace(item)
		if item == "" {
			continue
		}
		key := strings.ToLower(item)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, item)
	}
	return out
}

func extractHost(rawURL string) string {
	if rawURL == "" {
		return ""
	}
	u, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(u.Hostname()))
}

func isSocialOrAggregatorHost(host string) bool {
	if host == "" {
		return false
	}
	blocked := []string{
		"instagram.com", "www.instagram.com",
		"facebook.com", "www.facebook.com",
		"whatsapp.com", "api.whatsapp.com", "wa.me",
		"linktr.ee", "www.linktr.ee",
		"tiktok.com", "www.tiktok.com",
		"youtube.com", "www.youtube.com",
		"maps.google.com", "google.com",
		"dguests.com", "www.dguests.com",
	}
	for _, d := range blocked {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}

func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}
