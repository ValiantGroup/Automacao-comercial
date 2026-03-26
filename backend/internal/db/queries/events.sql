-- name: CreatePipelineEvent :one
INSERT INTO pipeline_events (company_id, type, payload)
VALUES ($1, $2, $3)
RETURNING *;

-- name: ListPipelineEvents :many
SELECT * FROM pipeline_events WHERE company_id = $1 ORDER BY created_at DESC;
