-- 000002_intelligence_unique.up.sql
-- Add unique constraint to company_id in company_intelligence table
-- to ensure one intelligence report per company and support ON CONFLICT operations.

ALTER TABLE company_intelligence ADD CONSTRAINT company_intelligence_company_id_key UNIQUE (company_id);
