-- name: GetCompany :one
SELECT * FROM companies WHERE id = $1;

-- name: ListCompanies :many
SELECT * FROM companies
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;

-- name: ListCompaniesByStage :many
SELECT * FROM companies
WHERE pipeline_stage = $1
ORDER BY created_at DESC;

-- name: ListCompaniesByNicheAndCity :many
SELECT * FROM companies
WHERE niche = $1 AND city = $2
ORDER BY ai_score DESC NULLS LAST;

-- name: CreateCompany :one
INSERT INTO companies (
  google_place_id, name, phone, website, address, city, state,
  lat, lng, category, google_rating, google_reviews_count, niche
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
)
RETURNING *;

-- name: GetCompanyByPlaceID :one
SELECT * FROM companies WHERE google_place_id = $1;

-- name: UpdateCompanyStage :one
UPDATE companies SET pipeline_stage = $2, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateCompanyEnrichmentStatus :one
UPDATE companies SET enrichment_status = $2, updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateCompanyAIScore :one
UPDATE companies SET ai_score = $2, enrichment_status = 'done', updated_at = NOW()
WHERE id = $1
RETURNING *;

-- name: UpdateCompanyEmbedding :exec
UPDATE companies SET embedding = $2, updated_at = NOW()
WHERE id = $1;

-- name: DeleteCompany :exec
DELETE FROM companies WHERE id = $1;

-- name: CountCompanies :one
SELECT COUNT(*) FROM companies;

-- name: CountCompaniesToday :one
SELECT COUNT(*) FROM companies WHERE created_at >= NOW()::date;

-- name: FindSimilarCompanies :many
SELECT id, name, address, embedding <=> $1 AS distance
FROM companies
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1
LIMIT 5;
