-- ============================================================================
-- 03_cron.sql — scheduled jobs (safety net + follow-ups).
-- Requires pg_cron + pg_net. Run as superuser on your self-hosted Postgres.
--
-- Replace:
--   <FUNCTIONS_URL>  e.g. http://kong:8000/functions/v1   (inside docker)
--   <SERVICE_ROLE_KEY>
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Queue drainer safety net. webhook-wsender already fires process-message
-- immediately on each inbound message; this catches anything left behind.
SELECT cron.schedule(
  'drain-message-queue',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := '<FUNCTIONS_URL>/process-message',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{"trigger":"cron"}'::jsonb
  );
  $$
);

-- Order follow-ups + inactivity follow-ups.
SELECT cron.schedule(
  'send-followups',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := '<FUNCTIONS_URL>/send-followups',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- LMS Notifications processor
SELECT cron.schedule(
  'process-lms-notifications',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := '<FUNCTIONS_URL>/process-lms-notifications',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <SERVICE_ROLE_KEY>"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- LMS Notifications cleanup (Delete sent messages older than 7 days)
SELECT cron.schedule(
  'cleanup-lms-queue',
  '0 2 * * *',
  $$
  DELETE FROM lms_notification_queue WHERE status = 'sent' AND created_at < now() - interval '7 days';
  $$
);

-- Inspect:  SELECT jobid, jobname, schedule FROM cron.job;
-- Remove:   SELECT cron.unschedule('drain-message-queue');
