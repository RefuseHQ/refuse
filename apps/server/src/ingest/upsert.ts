import type { NormalizedRecord, NormalizedAffectedPackage } from "./normalize";

import type { D1LikeDatabase, D1Statement } from "../db/adapter";
import type { CardReader } from "../cards";
/**
 * D1 batch upsert for normalized OSV records. Idempotent — running with the
 * same input twice produces the same result. The strategy:
 *
 * 1. UPSERT each `vulnerability` row keyed on refuse_id.
 * 2. DELETE existing affected_package rows for that refuse_id, then INSERT new.
 *    (OSV advisories evolve — an advisory can drop a previously-affected
 *    package or change its ranges. A blind UPSERT can't capture deletions.)
 * 3. Return the set of (ecosystem, package_name) tuples that changed, so the
 *    KV-card publisher can refresh just those.
 */

export interface AffectedKey {
  ecosystem: string;
  package_name: string;
}

export interface UpsertResult {
  vulnerabilities_written: number;
  affected_pairs_changed: AffectedKey[];
}

/* ─────────── SQL builders (pure, easy to test) ─────────── */

export function buildVulnerabilityUpsertSql(): string {
  return `
    INSERT INTO vulnerabilities (
      refuse_id, primary_id, aliases, summary, details,
      severity_score, severity_label, severity_vector, references_json,
      published_at, modified_at, withdrawn_at, raw_osv, is_malicious
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(refuse_id) DO UPDATE SET
      primary_id      = excluded.primary_id,
      aliases         = excluded.aliases,
      summary         = excluded.summary,
      details         = excluded.details,
      severity_score  = excluded.severity_score,
      severity_label  = excluded.severity_label,
      severity_vector = excluded.severity_vector,
      references_json = excluded.references_json,
      published_at    = excluded.published_at,
      modified_at     = excluded.modified_at,
      withdrawn_at    = excluded.withdrawn_at,
      raw_osv         = excluded.raw_osv,
      is_malicious    = excluded.is_malicious
    WHERE excluded.modified_at >= vulnerabilities.modified_at
  `;
}

export function bindVulnerabilityRow(
  rec: NormalizedRecord["vulnerability"],
): unknown[] {
  return [
    rec.refuse_id,
    rec.primary_id,
    JSON.stringify(rec.aliases),
    rec.summary,
    rec.details,
    rec.severity_score,
    rec.severity_label,
    rec.severity_vector,
    JSON.stringify(rec.references),
    rec.published_at,
    rec.modified_at,
    rec.withdrawn_at,
    rec.raw_osv,
    rec.is_malicious ? 1 : 0,
  ];
}

export function buildAffectedDeleteSql(): string {
  return `DELETE FROM affected_packages WHERE refuse_id = ?`;
}

export function buildAffectedInsertSql(): string {
  return `
    INSERT INTO affected_packages (refuse_id, ecosystem, package_name, ranges_json, fix_versions)
    VALUES (?, ?, ?, ?, ?)
  `;
}

export function bindAffectedRow(row: NormalizedAffectedPackage): unknown[] {
  return [
    row.refuse_id,
    row.ecosystem,
    row.package_name,
    JSON.stringify(row.ranges),
    JSON.stringify(row.fix_versions),
  ];
}

/* ─────────── Executor ─────────── */

export async function upsertRecords(
  db: D1LikeDatabase,
  records: NormalizedRecord[],
): Promise<UpsertResult> {
  if (records.length === 0) {
    return { vulnerabilities_written: 0, affected_pairs_changed: [] };
  }

  const vulnSql = buildVulnerabilityUpsertSql();
  const affectedDelSql = buildAffectedDeleteSql();
  const affectedInsSql = buildAffectedInsertSql();

  // Collect previously-affected packages so the publisher can refresh cards
  // even when an advisory drops a package. D1 caps bound parameters at 100
  // per statement, so we chunk the IN clause.
  const refuseIds = records.map((r) => r.vulnerability.refuse_id);
  const PRIOR_CHUNK = 90;
  const priorRows: Array<{ ecosystem: string; package_name: string }> = [];
  for (let i = 0; i < refuseIds.length; i += PRIOR_CHUNK) {
    const chunk = refuseIds.slice(i, i + PRIOR_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    const res = await db
      .prepare(
        `SELECT ecosystem, package_name FROM affected_packages WHERE refuse_id IN (${placeholders})`,
      )
      .bind(...chunk)
      .all<{ ecosystem: string; package_name: string }>();
    if (res.results) priorRows.push(...res.results);
  }
  const priorRes = { results: priorRows };

  const stmts: D1Statement[] = [];
  for (const r of records) {
    stmts.push(db.prepare(vulnSql).bind(...bindVulnerabilityRow(r.vulnerability)));
    stmts.push(db.prepare(affectedDelSql).bind(r.vulnerability.refuse_id));
    for (const a of r.affected) {
      stmts.push(db.prepare(affectedInsSql).bind(...bindAffectedRow(a)));
    }
  }

  await db.batch(stmts);

  const changed = new Map<string, AffectedKey>();
  for (const row of priorRes.results ?? []) {
    changed.set(`${row.ecosystem}::${row.package_name}`, row);
  }
  for (const r of records) {
    for (const a of r.affected) {
      changed.set(`${a.ecosystem}::${a.package_name}`, {
        ecosystem: a.ecosystem,
        package_name: a.package_name});
    }
  }

  return {
    vulnerabilities_written: records.length,
    affected_pairs_changed: Array.from(changed.values())};
}

export async function recordIngestionState(
  db: D1LikeDatabase,
  source: "osv" | "deps_dev" | "ghsa_direct" | "enrichment",
  status: "ok" | "error",
  recordsProcessed: number,
  options: { lastModified?: string; error?: string } = {},
): Promise<void> {
  const now = new Date().toISOString();
  // last_ok_at only advances on a successful run — error rows preserve the
  // prior good timestamp so the status page can surface "data was last
  // refreshed N minutes ago" even when the most recent attempt failed.
  const okAt = status === "ok" ? now : null;
  await db
    .prepare(
      `
      INSERT INTO ingestion_state (source, last_modified, last_run_at, last_status, last_error, last_ok_at, records_processed)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source) DO UPDATE SET
        last_modified     = COALESCE(excluded.last_modified, ingestion_state.last_modified),
        last_run_at       = excluded.last_run_at,
        last_status       = excluded.last_status,
        last_error        = excluded.last_error,
        last_ok_at        = COALESCE(excluded.last_ok_at, ingestion_state.last_ok_at),
        records_processed = excluded.records_processed
      `,
    )
    .bind(
      source,
      options.lastModified ?? null,
      now,
      status,
      options.error ?? null,
      okAt,
      recordsProcessed,
    )
    .run();
}
