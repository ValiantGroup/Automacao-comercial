-- 000004_campaign_controls.up.sql
-- Campaign-level controls for prospecting quality and live progress tracking.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS min_google_reviews INT NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS max_companies INT NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS min_ai_score_for_stakeholders INT NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS search_total_found INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS search_processed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS search_saved INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS search_skipped_low_reviews INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS search_skipped_duplicate INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS search_skipped_type INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS search_errors INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS search_last_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS search_last_finished_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_min_google_reviews_non_negative'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_min_google_reviews_non_negative
      CHECK (min_google_reviews >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_max_companies_positive'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_max_companies_positive
      CHECK (max_companies >= 1);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaigns_min_ai_score_for_stakeholders_range'
  ) THEN
    ALTER TABLE campaigns
      ADD CONSTRAINT campaigns_min_ai_score_for_stakeholders_range
      CHECK (min_ai_score_for_stakeholders BETWEEN 60 AND 100);
  END IF;
END $$;
