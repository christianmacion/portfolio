PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contact_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  idempotency_key_hash TEXT NOT NULL UNIQUE,
  body_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  user_agent TEXT,
  turnstile_verified INTEGER NOT NULL DEFAULT 0 CHECK (turnstile_verified IN (0,1)),
  notification_status TEXT NOT NULL DEFAULT 'pending' CHECK (notification_status IN ('pending','sent','delivered','failed','bounced')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  read_at INTEGER,
  archived_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS idx_contact_email ON contact_submissions(email);
CREATE INDEX IF NOT EXISTS idx_contact_created ON contact_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_ip_created ON contact_submissions(ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_inbox_unread ON contact_submissions(read_at, archived_at, created_at DESC);

CREATE TABLE IF NOT EXISTS notification_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contact_id INTEGER NOT NULL REFERENCES contact_submissions(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'resend' CHECK (channel='resend'),
  event_kind TEXT NOT NULL DEFAULT 'owner_contact_notification',
  dedupe_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','sending','sent','failed','dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT (unixepoch()),
  provider_message_id TEXT UNIQUE,
  last_error_code TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  sent_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS idx_outbox_ready ON notification_outbox(state, next_attempt_at, id);
CREATE INDEX IF NOT EXISTS idx_outbox_contact ON notification_outbox(contact_id);

CREATE TABLE IF NOT EXISTS email_delivery_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL DEFAULT 'resend' CHECK (provider='resend'),
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_message_id TEXT NOT NULL,
  contact_id INTEGER REFERENCES contact_submissions(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL DEFAULT (unixepoch()),
  processed_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS idx_email_event_message ON email_delivery_events(provider_message_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_event_received ON email_delivery_events(received_at DESC);

CREATE TABLE IF NOT EXISTS owner_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  actor_subject_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('contact.mark_read','contact.mark_unread')),
  target_public_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at INTEGER NOT NULL DEFAULT (unixepoch())
) STRICT;
CREATE INDEX IF NOT EXISTS idx_owner_audit_target ON owner_audit_log(target_public_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_owner_audit_time ON owner_audit_log(occurred_at DESC);

CREATE TABLE IF NOT EXISTS vitals_hourly (
  hour_start INTEGER NOT NULL,
  metric TEXT NOT NULL,
  route TEXT NOT NULL,
  device TEXT NOT NULL,
  weighted_samples INTEGER NOT NULL DEFAULT 0,
  p50 REAL NOT NULL,
  p75 REAL NOT NULL,
  p95 REAL NOT NULL,
  minimum REAL NOT NULL,
  maximum REAL NOT NULL,
  rolled_up_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (hour_start, metric, route, device)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_vitals_route_hour ON vitals_hourly(route, hour_start DESC);

CREATE TABLE IF NOT EXISTS maintenance_runs (
  dedupe_key TEXT PRIMARY KEY,
  job_name TEXT NOT NULL,
  scheduled_for INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 1,
  rows_affected INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  finished_at INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS idx_maintenance_job_time ON maintenance_runs(job_name, scheduled_for DESC);
