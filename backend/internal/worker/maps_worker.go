package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"golang.org/x/time/rate"

	"github.com/valiant-group/prospector/internal/config"
	db "github.com/valiant-group/prospector/internal/db/generated"
)

type mapsWorker struct {
	cfg     *config.Config
	queries *db.Queries
	client  *asynq.Client
	limiter *rate.Limiter
}

func newMapsWorker(cfg *config.Config, queries *db.Queries, client *asynq.Client) *mapsWorker {
	return &mapsWorker{
		cfg:     cfg,
		queries: queries,
		client:  client,
		limiter: rate.NewLimiter(rate.Every(time.Second/50), 10), // 50 rps
	}
}

type ProspectPayload struct {
	Niche      string `json:"niche"`
	City       string `json:"city"`
	RadiusKM   int    `json:"radius_km"`
	CampaignID string `json:"campaign_id"`
}

type mapsPlace struct {
	PlaceID         string   `json:"place_id"`
	Name            string   `json:"name"`
	FormattedAddress string  `json:"formatted_address"`
	Rating          float32  `json:"rating"`
	UserRatingsTotal int     `json:"user_ratings_total"`
	Types           []string `json:"types"`
	Geometry        struct {
		Location struct {
			Lat float64 `json:"lat"`
			Lng float64 `json:"lng"`
		} `json:"location"`
	} `json:"geometry"`
}

type mapsDetailsResult struct {
	Result struct {
		PlaceID              string `json:"place_id"`
		Name                 string `json:"name"`
		FormattedPhoneNumber string `json:"formatted_phone_number"`
		Website              string `json:"website"`
		FormattedAddress     string `json:"formatted_address"`
		Rating               float32 `json:"rating"`
		UserRatingsTotal     int    `json:"user_ratings_total"`
		AddressComponents    []struct {
			LongName  string   `json:"long_name"`
			Types     []string `json:"types"`
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

func (w *mapsWorker) Handle(ctx context.Context, t *asynq.Task) error {
	var p ProspectPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("unmarshal prospect payload: %w", err)
	}

	slog.Info("Starting prospect search", "niche", p.Niche, "city", p.City, "campaign_id", p.CampaignID)

	query := fmt.Sprintf("%s em %s", p.Niche, p.City)
	radiusMeters := p.RadiusKM * 1000

	places, err := w.searchPlaces(ctx, query, radiusMeters)
	if err != nil {
		return fmt.Errorf("search places: %w", err)
	}

	slog.Info("Found places", "count", len(places), "niche", p.Niche, "city", p.City)

	for _, place := range places {
		if err := w.limiter.Wait(ctx); err != nil {
			return err
		}

		if err := w.processPlace(ctx, place, p); err != nil {
			slog.Error("Process place failed", "place_id", place.PlaceID, "error", err)
			continue
		}
	}

	return nil
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

		req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
		if err != nil {
			return nil, err
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()

		var result struct {
			Results   []mapsPlace `json:"results"`
			NextPage  string      `json:"next_page_token"`
			Status    string      `json:"status"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
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
		time.Sleep(2 * time.Second) // required delay before next page token is valid
	}

	return allPlaces, nil
}

func (w *mapsWorker) processPlace(ctx context.Context, place mapsPlace, p ProspectPayload) error {
	// Check for duplicate by place ID
	existing, err := w.queries.GetCompanyByPlaceID(ctx, place.PlaceID)
	if err == nil && existing.ID.String() != "" {
		slog.Debug("Duplicate place, skipping", "place_id", place.PlaceID, "name", place.Name)
		return nil
	}

	// Fetch full details
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
		// Extract city/state from address components
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

	createParams := db.CreateCompanyParams{
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
	}

	company, err := w.queries.CreateCompany(ctx, createParams)
	if err != nil {
		return fmt.Errorf("create company: %w", err)
	}

	slog.Info("Company created", "id", company.ID, "name", company.Name)

	// Link to campaign
	if p.CampaignID != "" {
		// campaignID uuid parse ignored for brevity — in prod parse from string
		_ = p.CampaignID
	}

	// Enqueue enrichment tasks
	linkedInPayload, _ := json.Marshal(map[string]string{"company_id": company.ID.String()})
	webPayload, _ := json.Marshal(map[string]string{"company_id": company.ID.String()})
	hunterPayload, _ := json.Marshal(map[string]string{"company_id": company.ID.String()})

	if _, err := w.client.Enqueue(
		asynq.NewTask(TaskEnrichLinkedIn, linkedInPayload),
		asynq.MaxRetry(3),
		asynq.Queue("enrichment"),
	); err != nil {
		slog.Error("Enqueue linkedin enrichment failed", "company_id", company.ID, "error", err)
	}

	if _, err := w.client.Enqueue(
		asynq.NewTask(TaskEnrichWeb, webPayload),
		asynq.MaxRetry(3),
		asynq.Queue("enrichment"),
	); err != nil {
		slog.Error("Enqueue web enrichment failed", "company_id", company.ID, "error", err)
	}

	if _, err := w.client.Enqueue(
		asynq.NewTask(TaskEnrichHunter, hunterPayload),
		asynq.MaxRetry(3),
		asynq.Queue("enrichment"),
	); err != nil {
		slog.Error("Enqueue hunter enrichment failed", "company_id", company.ID, "error", err)
	}

	return nil
}

func (w *mapsWorker) fetchDetails(ctx context.Context, placeID string) (*mapsDetailsResult, error) {
	params := url.Values{
		"place_id": {placeID},
		"fields":   {"name,formatted_phone_number,website,formatted_address,rating,user_ratings_total,address_components,geometry,types"},
		"key":      {w.cfg.GoogleMapsAPIKey},
	}
	reqURL := "https://maps.googleapis.com/maps/api/place/details/json?" + params.Encode()

	req, err := http.NewRequestWithContext(ctx, "GET", reqURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var result mapsDetailsResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func strPtr(s string) *string { return &s }

func strIfNotEmpty(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}
