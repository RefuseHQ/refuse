-- API keys for the optional bearer-auth surface. Single-tenant; no owner column.
-- Created keys appear in the embedded UI at /ui/keys (gated by REFUSE_ADMIN_TOKEN).

CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  prefix       TEXT NOT NULL,            -- first ~12 chars of the key for display ("rfs_xxxxxxxx")
  hash         TEXT NOT NULL UNIQUE,     -- sha256 of the full key
  name         TEXT,                     -- user-supplied label
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE INDEX ix_api_keys_prefix ON api_keys(prefix);
