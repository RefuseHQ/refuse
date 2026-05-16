-- CISA Known Exploited Vulnerabilities (KEV) catalog and EPSS exploit
-- prediction scores. Both keyed by CVE ID. Joined to vulnerabilities via
-- json_each(aliases) at query time.

CREATE TABLE IF NOT EXISTS kev (
  cve_id            TEXT PRIMARY KEY,
  vendor_project    TEXT,
  product           TEXT,
  short_description TEXT,
  date_added        TEXT NOT NULL,           -- ISO date when CISA added it
  due_date          TEXT,                    -- federal remediation due date
  ransomware_use    INTEGER NOT NULL DEFAULT 0,  -- 1 if "Known"
  required_action   TEXT,
  notes             TEXT,
  fetched_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_kev_date_added ON kev(date_added DESC);

CREATE TABLE IF NOT EXISTS epss (
  cve_id      TEXT PRIMARY KEY,
  score       REAL NOT NULL,            -- 0..1 probability of exploit in next 30 days
  percentile  REAL NOT NULL,            -- 0..1 ranking among all CVEs
  scored_date TEXT NOT NULL,            -- date EPSS computed this score
  fetched_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS ix_epss_score ON epss(score DESC);
