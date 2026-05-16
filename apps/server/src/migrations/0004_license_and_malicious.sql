-- Two enrichment fields:
--
--   * package_versions.license_spdx / license_category — sourced from
--     deps.dev's GetVersion endpoint. Stored at the version row but in v1
--     populated with the package's default-version license for every row
--     (license rarely diverges between versions; future migration may switch
--     to true per-version fetches).
--
--   * vulnerabilities.is_malicious — set at normalize time when the OSV
--     primary id or any alias matches the `MAL-` prefix. Surfaced as a
--     distinct top-level flag in API responses because the correct response
--     ("do not install") differs from the CVE upgrade path.

ALTER TABLE package_versions ADD COLUMN license_spdx TEXT;
ALTER TABLE package_versions ADD COLUMN license_category TEXT;

ALTER TABLE vulnerabilities ADD COLUMN is_malicious INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ix_vulnerabilities_malicious
  ON vulnerabilities(is_malicious) WHERE is_malicious = 1;
