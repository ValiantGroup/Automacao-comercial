-- name: GetCampaign :one
SELECT * FROM campaigns WHERE id = $1;

-- name: ListCampaigns :many
SELECT * FROM campaigns ORDER BY created_at DESC;

-- name: CreateCampaign :one
INSERT INTO campaigns (
  name, niche, city, radius_km, daily_limit, auto_send, ai_prompt_context, channels, created_by,
  min_google_reviews, max_companies, min_ai_score_for_stakeholders
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING *;

-- name: UpdateCampaign :one
UPDATE campaigns SET
  name = $2, niche = $3, city = $4, radius_km = $5,
  daily_limit = $6, auto_send = $7, ai_prompt_context = $8,
  channels = $9,
  min_google_reviews = $10,
  max_companies = $11,
  min_ai_score_for_stakeholders = $12,
  updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateCampaignStatus :one
UPDATE campaigns SET status = $2, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: DeleteCampaign :exec
DELETE FROM campaigns WHERE id = $1;

-- name: AddCompanyToCampaign :exec
INSERT INTO campaign_companies (campaign_id, company_id)
VALUES ($1, $2)
ON CONFLICT DO NOTHING;

-- name: ListCampaignCompanies :many
SELECT c.* FROM companies c
JOIN campaign_companies cc ON cc.company_id = c.id
WHERE cc.campaign_id = $1
ORDER BY c.created_at DESC;

-- name: CountCampaignCompanies :one
SELECT COUNT(*)
FROM campaign_companies
WHERE campaign_id = $1;

-- name: CountCampaignAnalyzedCompanies :one
SELECT COUNT(*)
FROM campaign_companies cc
JOIN companies c ON c.id = cc.company_id
WHERE cc.campaign_id = $1
  AND c.ai_score IS NOT NULL;

-- name: CountCampaignStakeholders :one
SELECT COUNT(*)
FROM campaign_companies cc
JOIN stakeholders s ON s.company_id = cc.company_id
WHERE cc.campaign_id = $1;

-- name: CountCampaignMessages :one
SELECT COUNT(*)
FROM outreach_messages
WHERE campaign_id = $1;

-- name: BeginCampaignSearchRun :exec
UPDATE campaigns
SET
  search_total_found = $2,
  search_processed = 0,
  search_saved = 0,
  search_skipped_low_reviews = 0,
  search_skipped_duplicate = 0,
  search_skipped_type = 0,
  search_errors = 0,
  search_last_started_at = NOW(),
  search_last_finished_at = NULL,
  updated_at = NOW()
WHERE id = $1;

-- name: IncrementCampaignSearchCounters :exec
UPDATE campaigns
SET
  search_processed = search_processed + $2,
  search_saved = search_saved + $3,
  search_skipped_low_reviews = search_skipped_low_reviews + $4,
  search_skipped_duplicate = search_skipped_duplicate + $5,
  search_skipped_type = search_skipped_type + $6,
  search_errors = search_errors + $7,
  updated_at = NOW()
WHERE id = $1;

-- name: MarkCampaignSearchFinished :exec
UPDATE campaigns
SET
  search_last_finished_at = NOW(),
  updated_at = NOW()
WHERE id = $1;
