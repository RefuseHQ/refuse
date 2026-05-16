-- Initial vulnerability schema.
--   vulnerabilities       — one row per advisory (CVE, GHSA, malicious-package report)
--   affected_packages     — many rows per advisory; each (ecosystem, package_name) the advisory hits
--   package_versions      — known versions of each package + release date + license
--   ingestion_state       — cursor + last-run status per source (osv, deps_dev, ...)

CREATE TABLE IF NOT EXISTS vulnerabilities (
  refuse_id        TEXT PRIMARY KEY,           -- our stable ID, e.g. "rfs-2024-000123"
  primary_id       TEXT NOT NULL,              -- preferred external ID (CVE > GHSA > etc)
  aliases          TEXT NOT NULL,              -- JSON array of all known IDs
  summary          TEXT NOT NULL,
  details          TEXT,
  severity_score   REAL,                       -- numeric CVSS, 0.0-10.0
  severity_label   TEXT,                       -- "critical" | "high" | "medium" | "low"
  severity_vector  TEXT,                       -- full CVSS vector string
  references_json  TEXT,                       -- JSON array of reference URLs
  published_at     TEXT NOT NULL,              -- ISO 8601
  modified_at      TEXT NOT NULL,
  withdrawn_at     TEXT,
  raw_osv          TEXT NOT NULL               -- original OSV record for fidelity
);

CREATE INDEX IF NOT EXISTS ix_vuln_modified ON vulnerabilities(modified_at);

CREATE TABLE IF NOT EXISTS affected_packages (
  refuse_id     TEXT NOT NULL REFERENCES vulnerabilities(refuse_id),
  ecosystem     TEXT NOT NULL,                 -- canonical OSV ecosystem string
  package_name  TEXT NOT NULL,
  ranges_json   TEXT NOT NULL,                 -- JSON array of {introduced, fixed, last_affected}
  fix_versions  TEXT,                          -- JSON array of all "fixed" versions
  PRIMARY KEY (refuse_id, ecosystem, package_name)
);

CREATE INDEX IF NOT EXISTS ix_affected_lookup
  ON affected_packages(ecosystem, package_name);

CREATE TABLE IF NOT EXISTS package_versions (
  ecosystem      TEXT NOT NULL,
  package_name   TEXT NOT NULL,
  version        TEXT NOT NULL,
  is_prerelease  INTEGER NOT NULL DEFAULT 0,
  is_yanked      INTEGER NOT NULL DEFAULT 0,
  released_at    TEXT,
  PRIMARY KEY (ecosystem, package_name, version)
);

CREATE INDEX IF NOT EXISTS ix_pkg_versions_latest
  ON package_versions(ecosystem, package_name, released_at DESC);

CREATE TABLE IF NOT EXISTS ingestion_state (
  source             TEXT PRIMARY KEY,         -- "osv" | "deps_dev" | "kev" | ...
  last_modified      TEXT,
  last_run_at        TEXT NOT NULL,
  last_status        TEXT NOT NULL,            -- "ok" | "error"
  last_error         TEXT,
  records_processed  INTEGER DEFAULT 0,
  last_ok_at         TEXT                      -- set only on successful refresh
);
