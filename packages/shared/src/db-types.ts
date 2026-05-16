/* TypeScript shapes for SQLite row records. Mirrors the SQL schema in
 * apps/server/src/migrations/0001_initial_schema.sql. JSON columns are
 * stored as TEXT and parsed/serialized at the boundary. */

export interface VulnerabilityRow {
  refuse_id: string;
  primary_id: string;
  aliases: string;          // JSON-encoded string[]
  summary: string;
  details: string | null;
  severity_score: number | null;
  severity_label: string | null;
  severity_vector: string | null;
  references_json: string | null;  // JSON-encoded string[]
  published_at: string;
  modified_at: string;
  withdrawn_at: string | null;
  raw_osv: string;
}

export interface AffectedPackageRow {
  refuse_id: string;
  ecosystem: string;
  package_name: string;
  ranges_json: string;      // JSON-encoded AffectedRange[]
  fix_versions: string | null;  // JSON-encoded string[]
}

export interface PackageVersionRow {
  ecosystem: string;
  package_name: string;
  version: string;
  is_prerelease: 0 | 1;
  is_yanked: 0 | 1;
  released_at: string | null;
}

export interface IngestionStateRow {
  source: string;
  last_modified: string | null;
  last_run_at: string;
  last_status: "ok" | "error";
  last_error: string | null;
  records_processed: number;
}
