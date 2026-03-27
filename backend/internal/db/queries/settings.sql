-- name: GetSystemSetting :one
SELECT key, value_text, updated_at
FROM system_settings
WHERE key = $1;

-- name: UpsertSystemSetting :one
INSERT INTO system_settings (key, value_text, updated_at)
VALUES ($1, $2, NOW())
ON CONFLICT (key) DO UPDATE SET
  value_text = EXCLUDED.value_text,
  updated_at = NOW()
RETURNING key, value_text, updated_at;
