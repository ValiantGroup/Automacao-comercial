-- name: GetCampaign :one
SELECT * FROM campaigns WHERE id = $1;

-- name: ListCampaigns :many
SELECT * FROM campaigns ORDER BY created_at DESC;

-- name: CreateCampaign :one
INSERT INTO campaigns (name, niche, city, radius_km, daily_limit, auto_send, ai_prompt_context, channels, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: UpdateCampaign :one
UPDATE campaigns SET
  name = $2, niche = $3, city = $4, radius_km = $5,
  daily_limit = $6, auto_send = $7, ai_prompt_context = $8,
  channels = $9, updated_at = NOW()
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
