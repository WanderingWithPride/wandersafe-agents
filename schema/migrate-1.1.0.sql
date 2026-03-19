-- WanderSafe D1 Schema Migration: 1.0.0 → 1.1.0
-- Run: wrangler d1 execute wandersafe --file=schema/migrate-1.1.0.sql
--
-- Changes:
--   - community_reports: adds tally intake columns, removes NOT NULL on destination_id
--     (destination resolved by reviewer, not at submission time)
--   - safety_alerts: adds 'informational' to severity check

-- community_reports additions (SQLite ALTER TABLE supports ADD COLUMN only)
ALTER TABLE community_reports ADD COLUMN destination_raw       TEXT;
ALTER TABLE community_reports ADD COLUMN destination_normalized TEXT;
ALTER TABLE community_reports ADD COLUMN country_code          TEXT;
ALTER TABLE community_reports ADD COLUMN tally_response_id     TEXT;
ALTER TABLE community_reports ADD COLUMN submitted_at          TEXT;
ALTER TABLE community_reports ADD COLUMN severity              TEXT;
ALTER TABLE community_reports ADD COLUMN summary               TEXT;
ALTER TABLE community_reports ADD COLUMN description_sanitized TEXT;
ALTER TABLE community_reports ADD COLUMN classifier_error      TEXT;
ALTER TABLE community_reports ADD COLUMN human_reviewed        INTEGER NOT NULL DEFAULT 0;

-- Unique index for Tally idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_tally_id ON community_reports(tally_response_id)
  WHERE tally_response_id IS NOT NULL;

-- NOTE: SQLite does not support ALTER COLUMN or dropping constraints.
-- The severity CHECK on safety_alerts cannot be modified in place.
-- For new installs, apply d1-schema.sql which already includes 'informational'.
-- For existing installs: the constraint only fires on INSERT/UPDATE, so existing
-- rows are unaffected. New 'informational' rows will fail against the old constraint
-- until the table is recreated. If this is a concern, recreate safety_alerts:
--
--   CREATE TABLE safety_alerts_new AS SELECT * FROM safety_alerts;
--   DROP TABLE safety_alerts;
--   -- Then run the CREATE TABLE from d1-schema.sql v1.1.0
--   -- Then: INSERT INTO safety_alerts SELECT * FROM safety_alerts_new;
--   -- DROP TABLE safety_alerts_new;
--
-- For the WanderSafe production instance (still pre-launch), a full schema
-- reset (wrangler d1 execute wandersafe --file=schema/d1-schema.sql) is simpler.
