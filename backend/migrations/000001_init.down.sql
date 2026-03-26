-- 000001_init.down.sql
DROP TABLE IF EXISTS pipeline_events;
DROP TABLE IF EXISTS outreach_messages;
DROP TABLE IF EXISTS campaign_companies;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS stakeholders;
DROP TABLE IF EXISTS company_intelligence;
DROP TABLE IF EXISTS companies;
DROP TABLE IF EXISTS users;

DROP EXTENSION IF EXISTS vector;
DROP EXTENSION IF EXISTS "uuid-ossp";
