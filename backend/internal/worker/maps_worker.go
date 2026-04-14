package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"
	"github.com/valyala/fasthttp"
	"golang.org/x/time/rate"

	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
)

type mapsWorker struct {
	cfg         *config.Config
	queries     *db.Queries
	client      *asynq.Client
	limiter     *rate.Limiter
	httpClient  *fasthttp.Client
	broadcaster func(eventType string, payload interface{})
}

func newMapsWorker(cfg *config.Config, queries *db.Queries, client *asynq.Client, broadcaster func(string, interface{})) *mapsWorker {
	return &mapsWorker{
		cfg:     cfg,
		queries: queries,
		client:  client,
		limiter: rate.NewLimiter(rate.Every(time.Second/50), 10), // 50 rps
		httpClient: &fasthttp.Client{
			ReadTimeout:         30 * time.Second,
			WriteTimeout:        30 * time.Second,
			MaxIdleConnDuration: 60 * time.Second,
			MaxConnsPerHost:     40,
		},
		broadcaster: broadcaster,
	}
}

type ProspectPayload struct {
	Niche            string `json:"niche"`
	City             string `json:"city"`
	RadiusKM         int    `json:"radius_km"`
	CampaignID       string `json:"campaign_id"`
	MinGoogleReviews int    `json:"min_google_reviews"`
	MaxCompanies     int    `json:"max_companies"`
}

type mapsPlace struct {
	PlaceID          string   `json:"place_id"`
	Name             string   `json:"name"`
	FormattedAddress string   `json:"formatted_address"`
	Rating           float32  `json:"rating"`
	UserRatingsTotal int      `json:"user_ratings_total"`
	Types            []string `json:"types"`
	Geometry         struct {
		Location struct {
			Lat float64 `json:"lat"`
			Lng float64 `json:"lng"`
		} `json:"location"`
	} `json:"geometry"`
}

type mapsDetailsResult struct {
	Result struct {
		PlaceID              string  `json:"place_id"`
		Name                 string  `json:"name"`
		FormattedPhoneNumber string  `json:"formatted_phone_number"`
		Website              string  `json:"website"`
		FormattedAddress     string  `json:"formatted_address"`
		Rating               float32 `json:"rating"`
		UserRatingsTotal     int     `json:"user_ratings_total"`
		AddressComponents    []struct {
			LongName string   `json:"long_name"`
			Types    []string `json:"types"`
		} `json:"address_components"`
		Geometry struct {
			Location struct {
				Lat float64 `json:"lat"`
				Lng float64 `json:"lng"`
			} `json:"location"`
		} `json:"geometry"`
		Types []string `json:"types"`
	} `json:"result"`
}

type campaignSearchStats struct {
	Processed         int32
	Saved             int32
	SkippedLowReviews int32
	SkippedDuplicate  int32
	SkippedType       int32
	Errors            int32
}

type placeOutcome string

const (
	placeSaved            placeOutcome = "saved"
	placeSkippedDuplicate placeOutcome = "skipped_duplicate"
	placeSkippedType      placeOutcome = "skipped_type"
)

func (w *mapsWorker) Handle(ctx context.Context, t *asynq.Task) error {
	var p ProspectPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal prospect payload: %w", err)
	}

	if p.MinGoogleReviews < 0 {
		p.MinGoogleReviews = 100
	}
	if p.MaxCompanies <= 0 {
		p.MaxCompanies = 60
	}

	query := fmt.Sprintf("%s em %s", p.Niche, p.City)
	radiusMeters := p.RadiusKM * 1000

	slog.Info("Starting prospect search",
		"niche", p.Niche,
		"city", p.City,
		"campaign_id", p.CampaignID,
		"min_google_reviews", p.MinGoogleReviews,
		"max_companies", p.MaxCompanies)

	places, err := w.searchPlaces(ctx, query, radiusMeters)
	if err != nil {
		return fmt.Errorf("search places: %w", err)
	}

	slog.Info("Found places", "count", len(places), "niche", p.Niche, "city", p.City)

	campaignID, campaignOK := w.parseCampaignID(p.CampaignID)
	var existingCompanies int64
	if campaignOK {
		existingCompanies, err = w.queries.CountCampaignCompanies(ctx, campaignID)
		if err != nil {
			slog.Warn("Count campaign companies failed", "campaign_id", campaignID, "error", err)
			existingCompanies = 0
		}

		if err := w.queries.BeginCampaignSearchRun(ctx, campaignID, int32(len(places))); err != nil {
			slog.Warn("Begin campaign search run failed", "campaign_id", campaignID, "error", err)
		}

		w.emitEvent("campaign_search_started", map[string]interface{}{
			"campaign_id":           campaignID,
			"niche":                 p.Niche,
			"city":                  p.City,
			"min_google_reviews":    p.MinGoogleReviews,
			"max_companies":         p.MaxCompanies,
			"total_found":           len(places),
			"existing_companies":    existingCompanies,
			"search_started_at":     time.Now().UTC(),
			"companies_in_campaign": existingCompanies,
		})
	}

	stats := campaignSearchStats{}
	defer func(start time.Time) {
		if !campaignOK {
			return
		}
		if err := w.queries.MarkCampaignSearchFinished(context.Background(), campaignID); err != nil {
			slog.Warn("Mark campaign search finished failed", "campaign_id", campaignID, "error", err)
		}
		w.emitEvent("campaign_search_finished", map[string]interface{}{
			"campaign_id":           campaignID,
			"duration_seconds":      int(time.Since(start).Seconds()),
			"total_found":           len(places),
			"processed":             stats.Processed,
			"saved":                 stats.Saved,
			"skipped_low_reviews":   stats.SkippedLowReviews,
			"skipped_duplicate":     stats.SkippedDuplicate,
			"skipped_type":          stats.SkippedType,
			"errors":                stats.Errors,
			"companies_in_campaign": existingCompanies + int64(stats.Saved),
		})
	}(time.Now())

	if campaignOK && existingCompanies >= int64(p.MaxCompanies) {
		w.emitEvent("campaign_search_limit_reached", map[string]interface{}{
			"campaign_id":           campaignID,
			"max_companies":         p.MaxCompanies,
			"companies_in_campaign": existingCompanies,
		})
		return nil
	}

	for _, place := range places {
		if err := w.limiter.Wait(ctx); err != nil {
			return err
		}

		if campaignOK && (existingCompanies+int64(stats.Saved)) >= int64(p.MaxCompanies) {
			w.emitEvent("campaign_search_limit_reached", map[string]interface{}{
				"campaign_id":           campaignID,
				"max_companies":         p.MaxCompanies,
				"companies_in_campaign": existingCompanies + int64(stats.Saved),
			})
			break
		}

		delta := db.IncrementCampaignSearchCountersParams{
			ProcessedDelta: 1,
		}
		stats.Processed++

		if place.UserRatingsTotal < p.MinGoogleReviews {
			stats.SkippedLowReviews++
			delta.SkippedLowReviewsDelta = 1
			if campaignOK {
				delta.ID = campaignID
				w.incrementCounters(ctx, delta)
			}
			w.emitProgress(campaignID, campaignOK, p, stats, places, existingCompanies, map[string]interface{}{
				"reason":        "low_reviews",
				"company_name":  place.Name,
				"reviews_count": place.UserRatingsTotal,
			})
			continue
		}

		outcome, companyID, companyName, processErr := w.processPlace(ctx, place, p)
		if processErr != nil {
			stats.Errors++
			delta.ErrorsDelta = 1
			if campaignOK {
				delta.ID = campaignID
				w.incrementCounters(ctx, delta)
			}
			slog.Error("Process place failed", "place_id", place.PlaceID, "error", processErr)
			w.emitProgress(campaignID, campaignOK, p, stats, places, existingCompanies, map[string]interface{}{
				"reason":       "error",
				"company_name": place.Name,
				"error":        processErr.Error(),
			})
			continue
		}

		switch outcome {
		case placeSaved:
			stats.Saved++
			delta.SavedDelta = 1
		case placeSkippedDuplicate:
			stats.SkippedDuplicate++
			delta.SkippedDuplicateDelta = 1
		case placeSkippedType:
			stats.SkippedType++
			delta.SkippedTypeDelta = 1
		}

		if campaignOK {
			delta.ID = campaignID
			w.incrementCounters(ctx, delta)
		}

		w.emitProgress(campaignID, campaignOK, p, stats, places, existingCompanies, map[string]interface{}{
			"reason":       string(outcome),
			"company_id":   companyID,
			"company_name": companyName,
		})
	}

	return nil
}

func (w *mapsWorker) parseCampaignID(raw string) (uuid.UUID, bool) {
	if strings.TrimSpace(raw) == "" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		slog.Warn("Invalid campaign id in prospect payload", "campaign_id", raw, "error", err)
		return uuid.Nil, false
	}
	return id, true
}

func (w *mapsWorker) incrementCounters(ctx context.Context, delta db.IncrementCampaignSearchCountersParams) {
	if err := w.queries.IncrementCampaignSearchCounters(ctx, delta); err != nil {
		slog.Warn("Increment campaign search counters failed", "campaign_id", delta.ID, "error", err)
	}
}

func (w *mapsWorker) emitEvent(eventType string, payload interface{}) {
	if w.broadcaster != nil {
		w.broadcaster(eventType, payload)
	}
}

func (w *mapsWorker) emitProgress(
	campaignID uuid.UUID,
	campaignOK bool,
	p ProspectPayload,
	stats campaignSearchStats,
	places []mapsPlace,
	existingCompanies int64,
	extra map[string]interface{},
) {
	if !campaignOK {
		return
	}

	payload := map[string]interface{}{
		"campaign_id":           campaignID,
		"processed":             stats.Processed,
		"saved":                 stats.Saved,
		"skipped_low_reviews":   stats.SkippedLowReviews,
		"skipped_duplicate":     stats.SkippedDuplicate,
		"skipped_type":          stats.SkippedType,
		"errors":                stats.Errors,
		"total_found":           len(places),
		"max_companies":         p.MaxCompanies,
		"companies_in_campaign": existingCompanies + int64(stats.Saved),
	}
	for k, v := range extra {
		payload[k] = v
	}

	w.emitEvent("campaign_search_progress", payload)
}

func (w *mapsWorker) searchPlaces(ctx context.Context, query string, radiusMeters int) ([]mapsPlace, error) {
	baseURL := "https://maps.googleapis.com/maps/api/place/textsearch/json"
	params := url.Values{
		"query":  {query},
		"radius": {fmt.Sprintf("%d", radiusMeters)},
		"key":    {w.cfg.GoogleMapsAPIKey},
	}

	var allPlaces []mapsPlace
	pageToken := ""

	for {
		reqURL := baseURL + "?" + params.Encode()
		if pageToken != "" {
			reqURL += "&pagetoken=" + pageToken
		}

		if err := ctx.Err(); err != nil {
			return nil, err
		}

		req := fasthttp.AcquireRequest()
		resp := fasthttp.AcquireResponse()
		defer fasthttp.ReleaseRequest(req)
		defer fasthttp.ReleaseResponse(resp)

		req.SetRequestURI(reqURL)
		req.Header.SetMethod(fasthttp.MethodGet)
		req.Header.Set("Accept", "application/json")

		if err := w.httpClient.DoTimeout(req, resp, 30*time.Second); err != nil {
			return nil, err
		}
		if resp.StatusCode() >= fasthttp.StatusBadRequest {
			return nil, fmt.Errorf("maps textsearch returned status %d", resp.StatusCode())
		}

		var result struct {
			Results  []mapsPlace `json:"results"`
			NextPage string      `json:"next_page_token"`
			Status   string      `json:"status"`
		}
		if err := json.Unmarshal(resp.Body(), &result); err != nil {
			return nil, err
		}
		if result.Status != "OK" && result.Status != "ZERO_RESULTS" {
			return nil, fmt.Errorf("maps API status: %s", result.Status)
		}

		allPlaces = append(allPlaces, result.Results...)
		if result.NextPage == "" || len(allPlaces) >= 60 {
			break
		}
		pageToken = result.NextPage
		time.Sleep(2 * time.Second)
	}

	return allPlaces, nil
}

func (w *mapsWorker) processPlace(ctx context.Context, place mapsPlace, p ProspectPayload) (placeOutcome, string, string, error) {
	existing, err := w.queries.GetCompanyByPlaceID(ctx, place.PlaceID)
	if err == nil && existing.ID != uuid.Nil {
		return placeSkippedDuplicate, existing.ID.String(), existing.Name, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", fmt.Errorf("check company by place id: %w", err)
	}

	for _, t := range place.Types {
		if t == "locality" || t == "sublocality" || t == "neighborhood" || t == "administrative_area_level_1" || t == "administrative_area_level_2" {
			return placeSkippedType, "", place.Name, nil
		}
	}

	details, err := w.fetchDetails(ctx, place.PlaceID)
	if err != nil {
		slog.Warn("Could not fetch place details, using basic data", "place_id", place.PlaceID, "error", err)
	}

	rating := float32(place.Rating)
	reviewCount := int32(place.UserRatingsTotal)
	category := ""
	if len(place.Types) > 0 {
		category = place.Types[0]
	}

	phone := ""
	website := ""
	city := p.City
	state := ""

	if details != nil {
		phone = details.Result.FormattedPhoneNumber
		website = details.Result.Website
		for _, comp := range details.Result.AddressComponents {
			for _, t := range comp.Types {
				if t == "administrative_area_level_2" {
					city = comp.LongName
				}
				if t == "administrative_area_level_1" {
					state = comp.LongName
				}
			}
		}
	}

	company, err := w.queries.CreateCompany(ctx, db.CreateCompanyParams{
		GooglePlaceID:      strPtr(place.PlaceID),
		Name:               place.Name,
		Phone:              strIfNotEmpty(phone),
		Website:            strIfNotEmpty(website),
		Address:            strIfNotEmpty(place.FormattedAddress),
		City:               strIfNotEmpty(city),
		State:              strIfNotEmpty(state),
		Lat:                &place.Geometry.Location.Lat,
		Lng:                &place.Geometry.Location.Lng,
		Category:           strIfNotEmpty(category),
		GoogleRating:       &rating,
		GoogleReviewsCount: &reviewCount,
		Niche:              strPtr(p.Niche),
	})
	if err != nil {
		return "", "", "", fmt.Errorf("create company: %w", err)
	}

	if p.CampaignID != "" {
		campaignID, parseErr := uuid.Parse(p.CampaignID)
		if parseErr != nil {
			slog.Warn("Invalid campaign id in prospect payload", "campaign_id", p.CampaignID, "error", parseErr)
		} else if err := w.queries.AddCompanyToCampaign(ctx, campaignID, company.ID); err != nil {
			slog.Warn("Failed to link company to campaign", "company_id", company.ID, "campaign_id", campaignID, "error", err)
		}
	}

	webPayload, err := json.Marshal(map[string]string{
		"company_id":  company.ID.String(),
		"campaign_id": p.CampaignID,
	})
	if err != nil {
		return "", "", "", fmt.Errorf("marshal web payload: %w", err)
	}

	if _, err := w.client.Enqueue(
		asynq.NewTask(TaskEnrichWeb, webPayload),
		asynq.MaxRetry(3),
		asynq.Queue("enrichment"),
	); err != nil {
		slog.Error("Enqueue web enrichment failed", "company_id", company.ID, "error", err)
	}

	slog.Info("Company created", "id", company.ID, "name", company.Name)
	return placeSaved, company.ID.String(), company.Name, nil
}

func (w *mapsWorker) fetchDetails(ctx context.Context, placeID string) (*mapsDetailsResult, error) {
	params := url.Values{
		"place_id": {placeID},
		"fields":   {"name,formatted_phone_number,website,formatted_address,rating,user_ratings_total,address_components,geometry,types"},
		"key":      {w.cfg.GoogleMapsAPIKey},
	}
	reqURL := "https://maps.googleapis.com/maps/api/place/details/json?" + params.Encode()

	if err := ctx.Err(); err != nil {
		return nil, err
	}

	req := fasthttp.AcquireRequest()
	resp := fasthttp.AcquireResponse()
	defer fasthttp.ReleaseRequest(req)
	defer fasthttp.ReleaseResponse(resp)

	req.SetRequestURI(reqURL)
	req.Header.SetMethod(fasthttp.MethodGet)
	req.Header.Set("Accept", "application/json")

	if err := w.httpClient.DoTimeout(req, resp, 30*time.Second); err != nil {
		return nil, err
	}
	if resp.StatusCode() >= fasthttp.StatusBadRequest {
		return nil, fmt.Errorf("maps details returned status %d", resp.StatusCode())
	}

	var result mapsDetailsResult
	if err := json.Unmarshal(resp.Body(), &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func strPtr(s string) *string { return &s }

func strIfNotEmpty(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}
