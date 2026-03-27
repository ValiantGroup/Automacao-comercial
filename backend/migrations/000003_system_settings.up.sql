-- 000003_system_settings.up.sql
-- Global runtime settings stored in database.

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value_text  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value_text)
VALUES (
  'ai_global_context',
  'Valiant Group: parceiro estrategico em digitalizacao e automacao de processos para empresas B2B.'
)
ON CONFLICT (key) DO NOTHING;
