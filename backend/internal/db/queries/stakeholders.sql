-- name: GetStakeholder :one
SELECT * FROM stakeholders WHERE id = $1;

-- name: ListStakeholdersByCompany :many
SELECT * FROM stakeholders WHERE company_id = $1 ORDER BY created_at;

-- name: CreateStakeholder :one
INSERT INTO stakeholders (company_id, name, normalized_role, raw_title, linkedin_url, email, phone, source)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: UpdateStakeholderRole :exec
UPDATE stakeholders SET normalized_role = $2 WHERE id = $1;

-- name: GetPriorityStakeholder :one
SELECT * FROM stakeholders
WHERE company_id = $1
ORDER BY
  CASE normalized_role
    WHEN 'CEO' THEN 1
    WHEN 'CTO' THEN 2
    WHEN 'HEAD_COMERCIAL' THEN 3
    WHEN 'HEAD_ADM' THEN 4
    WHEN 'HEAD_TECH' THEN 5
    ELSE 6
  END
LIMIT 1;
