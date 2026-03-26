-- 000001_init.up.sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- Users
-- =============================================================================
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'operator', -- admin | operator
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Companies
-- =============================================================================
CREATE TABLE companies (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  google_place_id      TEXT UNIQUE,
  name                 TEXT NOT NULL,
  phone                TEXT,
  website              TEXT,
  address              TEXT,
  city                 TEXT,
  state                TEXT,
  lat                  DOUBLE PRECISION,
  lng                  DOUBLE PRECISION,
  category             TEXT,
  google_rating        NUMERIC(2,1),
  google_reviews_count INT,
  niche                TEXT,
  enrichment_status    TEXT NOT NULL DEFAULT 'pending',   -- pending|processing|done|failed
  ai_score             INT,
  pipeline_stage       TEXT NOT NULL DEFAULT 'prospected', -- prospected|enriched|analyzed|approved|contacted|replied|meeting|lost
  embedding            vector(1536),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Company Intelligence
-- =============================================================================
CREATE TABLE company_intelligence (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  summary              TEXT,
  pain_points          JSONB DEFAULT '[]',
  fit_score            INT,
  fit_justification    TEXT,
  tech_stack           JSONB DEFAULT '[]',
  reputation_score     NUMERIC(3,1),
  reputation_summary   TEXT,
  open_jobs            JSONB DEFAULT '[]',
  linkedin_followers   INT,
  linkedin_about       TEXT,
  website_description  TEXT,
  persona_priority     TEXT,
  persona_justification TEXT,
  raw_web_data         JSONB,
  raw_linkedin_data    JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Stakeholders
-- =============================================================================
CREATE TABLE stakeholders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  normalized_role TEXT,  -- CEO|CTO|HEAD_COMERCIAL|HEAD_ADM|HEAD_TECH|OTHER
  raw_title       TEXT,
  linkedin_url    TEXT,
  email           TEXT,
  phone           TEXT,
  source          TEXT,  -- linkedin|apollo|hunter|manual
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Campaigns
-- =============================================================================
CREATE TABLE campaigns (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  niche             TEXT NOT NULL,
  city              TEXT NOT NULL,
  radius_km         INT NOT NULL DEFAULT 10,
  status            TEXT NOT NULL DEFAULT 'draft', -- draft|running|paused|finished
  daily_limit       INT NOT NULL DEFAULT 50,
  auto_send         BOOLEAN NOT NULL DEFAULT FALSE,
  ai_prompt_context TEXT NOT NULL,
  channels          JSONB NOT NULL DEFAULT '["whatsapp"]',
  created_by        UUID NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Campaign ↔ Company join
-- =============================================================================
CREATE TABLE campaign_companies (
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, company_id)
);

-- =============================================================================
-- Outreach Messages
-- =============================================================================
CREATE TABLE outreach_messages (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  stakeholder_id       UUID REFERENCES stakeholders(id),
  campaign_id          UUID NOT NULL REFERENCES campaigns(id),
  channel              TEXT NOT NULL, -- whatsapp|email
  content              TEXT NOT NULL,
  subject              TEXT,          -- email only
  status               TEXT NOT NULL DEFAULT 'pending_review', -- pending_review|approved|rejected|sent|failed|opened|replied
  sent_at              TIMESTAMPTZ,
  opened_at            TIMESTAMPTZ,
  replied_at           TIMESTAMPTZ,
  sendgrid_message_id  TEXT,
  evolution_message_id TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Pipeline Events
-- =============================================================================
CREATE TABLE pipeline_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type       TEXT NOT NULL, -- prospected|enrichment_started|enrichment_done|ai_analyzed|message_generated|message_sent|replied|stage_changed
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX ON companies(niche);
CREATE INDEX ON companies(city);
CREATE INDEX ON companies(pipeline_stage);
CREATE INDEX ON companies(enrichment_status);
CREATE INDEX ON companies USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON stakeholders(company_id);
CREATE INDEX ON outreach_messages(company_id);
CREATE INDEX ON outreach_messages(status);
CREATE INDEX ON pipeline_events(company_id);
CREATE INDEX ON pipeline_events(created_at DESC);
CREATE INDEX ON campaign_companies(campaign_id);
CREATE INDEX ON campaign_companies(company_id);
