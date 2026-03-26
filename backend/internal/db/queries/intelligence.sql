-- name: GetIntelligence :one
SELECT * FROM company_intelligence WHERE company_id = $1;

-- name: UpsertIntelligence :one
INSERT INTO company_intelligence (company_id, summary, pain_points, fit_score, fit_justification, tech_stack,
  reputation_score, reputation_summary, open_jobs, linkedin_followers, linkedin_about, website_description,
  persona_priority, persona_justification, raw_web_data, raw_linkedin_data)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
ON CONFLICT (company_id) DO UPDATE SET
  summary = EXCLUDED.summary,
  pain_points = EXCLUDED.pain_points,
  fit_score = EXCLUDED.fit_score,
  fit_justification = EXCLUDED.fit_justification,
  tech_stack = EXCLUDED.tech_stack,
  reputation_score = EXCLUDED.reputation_score,
  reputation_summary = EXCLUDED.reputation_summary,
  open_jobs = EXCLUDED.open_jobs,
  linkedin_followers = EXCLUDED.linkedin_followers,
  linkedin_about = EXCLUDED.linkedin_about,
  website_description = EXCLUDED.website_description,
  persona_priority = EXCLUDED.persona_priority,
  persona_justification = EXCLUDED.persona_justification,
  raw_web_data = EXCLUDED.raw_web_data,
  raw_linkedin_data = EXCLUDED.raw_linkedin_data,
  updated_at = NOW()
RETURNING *;

-- name: UpdateIntelligenceWebData :exec
UPDATE company_intelligence SET raw_web_data = $2, website_description = $3, tech_stack = $4,
  reputation_score = $5, reputation_summary = $6, updated_at = NOW()
WHERE company_id = $1;

-- name: UpdateIntelligenceLinkedIn :exec
UPDATE company_intelligence SET raw_linkedin_data = $2, linkedin_about = $3, linkedin_followers = $4,
  open_jobs = $5, updated_at = NOW()
WHERE company_id = $1;
