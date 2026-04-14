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
	WebsiteURL           string
	WebsiteHost          string
	HasWebsite           bool
	HasCorporateSite     bool
	HasWebsiteDesc       bool
	HasContactChannels   bool
	ContactChannelsCount int
	TechStack            []string
	OpenJobs             []string
	SiteIssues           []string
	RawPainSignals       []string
	WhatCompanyDoes      []string
	LocationHints        []string
	ReclameAquiTopics    []string
	RecentComplaints     []string
	RespondedPercentage  *float32
	WouldDoBusinessAgain *float32
	StakeholderCount     int
	StakeholderRoles     []string
	ReputationScore      *float32
	ReputationSummary    string
	GoogleRating         *float32
	GoogleReviewsCount   *int32
}

type rawWebPayload struct {
	Website     rawWebsiteData     `json:"website"`
	ReclameAqui rawReclameAquiData `json:"reclame_aqui"`
	Derived     rawDerivedData     `json:"derived"`
}

type rawWebsiteData struct {
	Title           string                    `json:"title"`
	Description     string                    `json:"description"`
	TextContent     string                    `json:"text_content"`
	TextSamples     []string                  `json:"text_samples"`
	Links           []string                  `json:"links"`
	PagesScanned    []string                  `json:"pages_scanned"`
	PageSummaries   []rawWebsitePageSummary   `json:"scanned_page_summaries"`
	Headings        rawWebsiteHeadings        `json:"headings"`
	ContactSignals  rawWebsiteContactSignals  `json:"contact_signals"`
	BusinessSignals rawWebsiteBusinessSignals `json:"business_signals"`
	Issues          []rawWebsiteIssue         `json:"issues"`
}

type rawWebsiteHeadings struct {
	H1 []string `json:"h1"`
	H2 []string `json:"h2"`
	H3 []string `json:"h3"`
}

type rawWebsitePageSummary struct {
	URL         string `json:"url"`
	Title       string `json:"title"`
	Description string `json:"description"`
}

type rawWebsiteContactSignals struct {
	Emails          []string `json:"emails"`
	Phones          []string `json:"phones"`
	WhatsAppNumbers []string `json:"whatsapp_numbers"`
	Addresses       []string `json:"addresses"`
	SocialLinks     []string `json:"social_links"`
	ContactPages    []string `json:"contact_pages"`
}

type rawWebsiteBusinessSignals struct {
	WhatCompanyDoes   []string `json:"what_company_does"`
	ValuePropositions []string `json:"value_propositions"`
	TargetMarketHints []string `json:"target_market_hints"`
	LocationHints     []string `json:"location_hints"`
	CTAPhrases        []string `json:"cta_phrases"`
}

type rawWebsiteIssue struct {
	Code     string `json:"code"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
}

type rawReclameAquiData struct {
	ComplaintTopics                []string `json:"complaint_topics"`
	RecentComplaints               []string `json:"recent_complaints"`
	RespondedPercentage            *float32 `json:"responded_percentage"`
	WouldDoBusinessAgainPercentage *float32 `json:"would_do_business_again_percentage"`
}

type rawDerivedData struct {
	WhatCompanyDoes  []string `json:"what_company_does"`
	LocationHints    []string `json:"location_hints"`
	SiteIssues       []string `json:"site_issues"`
	PainSignals      []string `json:"pain_signals"`
	AIAboutCompany   string   `json:"ai_about_company"`
	AIWhatCompany    []string `json:"ai_what_company_does"`
	AICoreOffers     []string `json:"ai_core_offers"`
	AILocationHints  []string `json:"ai_location_hints"`
	AIPainHypotheses []string `json:"ai_pain_hypotheses"`
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
	rawWeb := parseRawWebPayload(intel.RawWebData)

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

	contactChannels := dedupeNonEmptyStrings(append(
		append([]string{}, rawWeb.Website.ContactSignals.Emails...),
		append(rawWeb.Website.ContactSignals.Phones, rawWeb.Website.ContactSignals.WhatsAppNumbers...)...,
	))
	if len(rawWeb.Website.ContactSignals.ContactPages) > 0 {
		contactChannels = append(contactChannels, rawWeb.Website.ContactSignals.ContactPages...)
	}

	siteIssues := make([]string, 0, len(rawWeb.Website.Issues)+len(rawWeb.Derived.SiteIssues))
	siteIssues = append(siteIssues, rawWeb.Derived.SiteIssues...)
	for _, issue := range rawWeb.Website.Issues {
		msg := strings.TrimSpace(issue.Message)
		if msg == "" {
			continue
		}
		if sev := strings.TrimSpace(issue.Severity); sev != "" {
			msg = fmt.Sprintf("[%s] %s", strings.ToUpper(sev), msg)
		}
		siteIssues = append(siteIssues, msg)
	}

	whatCompanyDoes := dedupeNonEmptyStrings(append(
		append(rawWeb.Derived.AIWhatCompany, rawWeb.Derived.WhatCompanyDoes...),
		rawWeb.Website.BusinessSignals.WhatCompanyDoes...,
	))
	locationHints := dedupeNonEmptyStrings(append(
		append(
			append(rawWeb.Derived.AILocationHints, rawWeb.Derived.LocationHints...),
			rawWeb.Website.BusinessSignals.LocationHints...,
		),
		rawWeb.Website.ContactSignals.Addresses...,
	))

	return analysisEvidence{
		WebsiteURL:           websiteURL,
		WebsiteHost:          host,
		HasWebsite:           websiteURL != "",
		HasCorporateSite:     hasCorporateSite,
		HasWebsiteDesc:       strings.TrimSpace(ptrToString(intel.WebsiteDescription)) != "",
		HasContactChannels:   len(contactChannels) > 0,
		ContactChannelsCount: len(contactChannels),
		TechStack:            tech,
		OpenJobs:             openJobs,
		SiteIssues:           dedupeNonEmptyStrings(siteIssues),
		RawPainSignals:       dedupeNonEmptyStrings(rawWeb.Derived.PainSignals),
		WhatCompanyDoes:      whatCompanyDoes,
		LocationHints:        locationHints,
		ReclameAquiTopics:    dedupeNonEmptyStrings(rawWeb.ReclameAqui.ComplaintTopics),
		RecentComplaints:     dedupeNonEmptyStrings(rawWeb.ReclameAqui.RecentComplaints),
		RespondedPercentage:  rawWeb.ReclameAqui.RespondedPercentage,
		WouldDoBusinessAgain: rawWeb.ReclameAqui.WouldDoBusinessAgainPercentage,
		StakeholderCount:     len(stakeholders),
		StakeholderRoles:     roleSet,
		ReputationScore:      intel.ReputationScore,
		ReputationSummary:    strings.TrimSpace(ptrToString(intel.ReputationSummary)),
		GoogleRating:         company.GoogleRating,
		GoogleReviewsCount:   company.GoogleReviewsCount,
	}
}

func buildSummary(company db.Company, ev analysisEvidence) string {
	niche := strings.TrimSpace(ptrToString(company.Niche))
	if niche == "" {
		niche = "nao informado"
	}
	location := strings.TrimSpace(ptrToString(company.City))
	if location == "" {
		if len(ev.LocationHints) > 0 {
			location = ev.LocationHints[0]
		} else {
			location = "nao informada"
		}
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

	whatCompanyDoes := "atuacao nao inferida no site"
	if len(ev.WhatCompanyDoes) > 0 {
		whatCompanyDoes = ev.WhatCompanyDoes[0]
	}

	contactSignals := "sem canais de contato claros no site"
	if ev.HasContactChannels {
		contactSignals = fmt.Sprintf("%d canais de contato detectados", ev.ContactChannelsCount)
	}

	issueSignals := "sem alertas evidentes no site"
	if len(ev.SiteIssues) > 0 {
		issueSignals = fmt.Sprintf("%d alertas de website", len(ev.SiteIssues))
	}

	raTopics := ""
	if len(ev.ReclameAquiTopics) > 0 {
		raTopics = fmt.Sprintf(" Topicos no Reclame Aqui: %s.", strings.Join(ev.ReclameAquiTopics[:min(3, len(ev.ReclameAquiTopics))], ", "))
	}

	return fmt.Sprintf(
		"%s atua no nicho %s em %s. Sinal principal do site: %s. Evidencias coletadas: %s, %s, %s, %d stakeholders mapeados, %d tecnologias detectadas e %s.%s",
		company.Name,
		niche,
		location,
		whatCompanyDoes,
		websiteStatus,
		contactSignals,
		issueSignals,
		ev.StakeholderCount,
		len(ev.TechStack),
		reputation,
		raTopics,
	)
}

func buildEvidencePainPoints(ev analysisEvidence) []string {
	pains := make([]string, 0, 10)

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
	if !ev.HasContactChannels {
		pains = append(pains, "Nao foram detectados canais de contato claros no website.")
	}

	if ev.ReputationScore == nil {
		pains = append(pains, "Nao foi possivel validar reputacao externa.")
	} else if *ev.ReputationScore < 7 {
		pains = append(pains, fmt.Sprintf("Reputacao publica abaixo de 7/10 (%.1f).", *ev.ReputationScore))
	}
	if ev.RespondedPercentage != nil && *ev.RespondedPercentage < 80 {
		pains = append(pains, fmt.Sprintf("Percentual de resposta no Reclame Aqui abaixo de 80%% (%.0f%%).", *ev.RespondedPercentage))
	}
	if len(ev.ReclameAquiTopics) > 0 {
		pains = append(pains, "Topicos de reclamacao recorrentes: "+strings.Join(ev.ReclameAquiTopics[:min(4, len(ev.ReclameAquiTopics))], ", "))
	}
	if len(ev.RecentComplaints) > 0 {
		pains = append(pains, "Reclamacoes recentes: "+strings.Join(ev.RecentComplaints[:min(3, len(ev.RecentComplaints))], " | "))
	}
	for _, issue := range ev.SiteIssues {
		pains = append(pains, "Sinal no site: "+issue)
		if len(pains) >= 10 {
			break
		}
	}
	pains = append(pains, ev.RawPainSignals...)

	if len(ev.OpenJobs) > 0 {
		pains = append(pains, fmt.Sprintf("Foram identificadas %d vagas abertas.", len(ev.OpenJobs)))
	}

	pains = dedupeNonEmptyStrings(pains)
	if len(pains) == 0 {
		pains = append(pains, "Evidencias insuficientes para apontar dores especificas.")
	}
	if len(pains) > 10 {
		return pains[:10]
	}
	return pains
}

func computeDeterministicFitScore(ev analysisEvidence) int {
	opportunity := 10
	if !ev.HasCorporateSite {
		opportunity += 22
	}
	if len(ev.TechStack) == 0 {
		opportunity += 15
	}
	if ev.StakeholderCount == 0 {
		opportunity += 10
	}
	if !ev.HasContactChannels {
		opportunity += 15
	}
	if len(ev.SiteIssues) > 0 {
		opportunity += min(len(ev.SiteIssues)*4, 20)
	}
	if ev.ReputationScore != nil && *ev.ReputationScore < 7 {
		opportunity += 15
	}
	if len(ev.ReclameAquiTopics) > 0 {
		opportunity += 10
	}
	if len(ev.OpenJobs) > 0 {
		opportunity += 8
	}
	if ev.GoogleReviewsCount != nil && *ev.GoogleReviewsCount >= 200 {
		opportunity += 5
	}
	if ev.HasCorporateSite && len(ev.TechStack) > 0 {
		opportunity += 3
	}

	confidence := 15
	if ev.HasWebsiteDesc || ev.HasCorporateSite {
		confidence += 15
	}
	if len(ev.WhatCompanyDoes) > 0 {
		confidence += 15
	}
	if ev.HasContactChannels {
		confidence += 10
	}
	if len(ev.TechStack) > 0 {
		confidence += 15
	}
	if ev.ReputationScore != nil || len(ev.ReclameAquiTopics) > 0 {
		confidence += 15
	}
	if ev.StakeholderCount > 0 {
		confidence += 15
	}
	if len(ev.OpenJobs) > 0 {
		confidence += 10
	}
	if len(ev.SiteIssues) > 0 {
		confidence += 10
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
		"Score %d calculado por regras objetivas sobre evidencias coletadas: website (%s), stack (%d), canais de contato (%d), alertas de site (%d), stakeholders (%d), reputacao (%s), topicos Reclame Aqui (%d), vagas (%d).",
		fitScore,
		website,
		len(ev.TechStack),
		ev.ContactChannelsCount,
		len(ev.SiteIssues),
		ev.StakeholderCount,
		reputation,
		len(ev.ReclameAquiTopics),
		len(ev.OpenJobs),
	)
}

func choosePersona(ev analysisEvidence) (string, string) {
	priorityOrder := []string{"CEO", "CTO", "HEAD_COMERCIAL", "HEAD_ADM", "HEAD_TECH"}
	for _, role := range priorityOrder {
		if slices.Contains(ev.StakeholderRoles, role) {
			return normalizePersona(role), fmt.Sprintf("Persona priorizada com base em stakeholder identificado: %s.", role)
		}
	}

	if len(ev.ReclameAquiTopics) > 0 || len(ev.SiteIssues) >= 3 {
		return "HEAD_ADM", "Sinais operacionais no site/Reclame Aqui sugerem prioridade para lideranca administrativa/operacional."
	}
	if !ev.HasCorporateSite || len(ev.TechStack) == 0 {
		return "CEO", "Sem decisor mapeado, CEO priorizado para alinhamento estrategico."
	}
	if !ev.HasContactChannels {
		return "HEAD_COMERCIAL", "Ausencia de canais de contato claros sugere foco em estruturacao comercial."
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
	return dedupeNonEmptyStrings(arr)
}

func parseRawWebPayload(raw json.RawMessage) rawWebPayload {
	if len(raw) == 0 {
		return rawWebPayload{}
	}
	var out rawWebPayload
	if err := json.Unmarshal(raw, &out); err != nil {
		return rawWebPayload{}
	}
	out.Website.ContactSignals.Emails = dedupeNonEmptyStrings(out.Website.ContactSignals.Emails)
	out.Website.ContactSignals.Phones = dedupeNonEmptyStrings(out.Website.ContactSignals.Phones)
	out.Website.ContactSignals.WhatsAppNumbers = dedupeNonEmptyStrings(out.Website.ContactSignals.WhatsAppNumbers)
	out.Website.ContactSignals.Addresses = dedupeNonEmptyStrings(out.Website.ContactSignals.Addresses)
	out.Website.ContactSignals.SocialLinks = dedupeNonEmptyStrings(out.Website.ContactSignals.SocialLinks)
	out.Website.ContactSignals.ContactPages = dedupeNonEmptyStrings(out.Website.ContactSignals.ContactPages)
	out.Website.TextSamples = dedupeNonEmptyStrings(out.Website.TextSamples)
	out.Website.Links = dedupeNonEmptyStrings(out.Website.Links)
	out.Website.PagesScanned = dedupeNonEmptyStrings(out.Website.PagesScanned)
	out.Website.Headings.H1 = dedupeNonEmptyStrings(out.Website.Headings.H1)
	out.Website.Headings.H2 = dedupeNonEmptyStrings(out.Website.Headings.H2)
	out.Website.Headings.H3 = dedupeNonEmptyStrings(out.Website.Headings.H3)
	out.Website.BusinessSignals.WhatCompanyDoes = dedupeNonEmptyStrings(out.Website.BusinessSignals.WhatCompanyDoes)
	out.Website.BusinessSignals.ValuePropositions = dedupeNonEmptyStrings(out.Website.BusinessSignals.ValuePropositions)
	out.Website.BusinessSignals.TargetMarketHints = dedupeNonEmptyStrings(out.Website.BusinessSignals.TargetMarketHints)
	out.Website.BusinessSignals.LocationHints = dedupeNonEmptyStrings(out.Website.BusinessSignals.LocationHints)
	out.Website.BusinessSignals.CTAPhrases = dedupeNonEmptyStrings(out.Website.BusinessSignals.CTAPhrases)
	cleanPages := make([]rawWebsitePageSummary, 0, len(out.Website.PageSummaries))
	seenPage := make(map[string]bool, len(out.Website.PageSummaries))
	for _, page := range out.Website.PageSummaries {
		page.URL = strings.TrimSpace(page.URL)
		page.Title = strings.TrimSpace(page.Title)
		page.Description = strings.TrimSpace(page.Description)
		if page.URL == "" || seenPage[strings.ToLower(page.URL)] {
			continue
		}
		seenPage[strings.ToLower(page.URL)] = true
		cleanPages = append(cleanPages, page)
		if len(cleanPages) >= 16 {
			break
		}
	}
	out.Website.PageSummaries = cleanPages
	out.ReclameAqui.ComplaintTopics = dedupeNonEmptyStrings(out.ReclameAqui.ComplaintTopics)
	out.ReclameAqui.RecentComplaints = dedupeNonEmptyStrings(out.ReclameAqui.RecentComplaints)
	out.Derived.WhatCompanyDoes = dedupeNonEmptyStrings(out.Derived.WhatCompanyDoes)
	out.Derived.LocationHints = dedupeNonEmptyStrings(out.Derived.LocationHints)
	out.Derived.SiteIssues = dedupeNonEmptyStrings(out.Derived.SiteIssues)
	out.Derived.PainSignals = dedupeNonEmptyStrings(out.Derived.PainSignals)
	out.Derived.AIAboutCompany = strings.TrimSpace(out.Derived.AIAboutCompany)
	out.Derived.AIWhatCompany = dedupeNonEmptyStrings(out.Derived.AIWhatCompany)
	out.Derived.AICoreOffers = dedupeNonEmptyStrings(out.Derived.AICoreOffers)
	out.Derived.AILocationHints = dedupeNonEmptyStrings(out.Derived.AILocationHints)
	out.Derived.AIPainHypotheses = dedupeNonEmptyStrings(out.Derived.AIPainHypotheses)
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
