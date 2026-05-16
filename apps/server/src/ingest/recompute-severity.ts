import { calculateCvssBaseScore } from "./cvss";

import type { D1LikeDatabase, D1Statement } from "../db/adapter";
import type { CardReader } from "../cards";
type Row = { refuse_id: string; severity_vector: string | null };

function scoreToLabel(score: number | null): string {
  if (score === null) return "unknown";
  if (score === 0) return "low";
  if (score < 4) return "low";
  if (score < 7) return "medium";
  if (score < 9) return "high";
  return "critical";
}

export interface RecomputeResult {
  scanned: number;
  updated: number;
  done: boolean;
  next_after: string | null;
  duration_ms: number;
}

/**
 * Recompute severity_score and severity_label across all vulnerability rows
 * using the current `calculateCvssBaseScore`. Idempotent. Cursor-paginated
 * with `after` (refuse_id) so the caller can drive multiple invocations
 * until done.
 */
export async function recomputeSeverity(
  db: D1LikeDatabase,
  opts: { batchSize?: number; after?: string | null } = {},
): Promise<RecomputeResult> {
  const startedAt = Date.now();
  const batchSize = Math.min(Math.max(opts.batchSize ?? 500, 1), 2000);
  const after = opts.after ?? "";

  const rows = await db
    .prepare(
      `SELECT refuse_id, severity_vector FROM vulnerabilities
       WHERE refuse_id > ? AND severity_vector IS NOT NULL
       ORDER BY refuse_id ASC LIMIT ?`,
    )
    .bind(after, batchSize)
    .all<Row>();

  const results = rows.results ?? [];
  if (results.length === 0) {
    return {
      scanned: 0,
      updated: 0,
      done: true,
      next_after: null,
      duration_ms: Date.now() - startedAt};
  }

  const updates: D1Statement[] = [];
  let updated = 0;
  for (const row of results) {
    const vector = row.severity_vector;
    if (!vector) continue;
    const score = calculateCvssBaseScore(vector);
    const label = scoreToLabel(score);
    updates.push(
      db
        .prepare(
          `UPDATE vulnerabilities
           SET severity_score = ?, severity_label = ?
           WHERE refuse_id = ?`,
        )
        .bind(score, label, row.refuse_id),
    );
    updated++;
  }

  // D1 batches are limited; chunk into ~50-stmt sub-batches.
  const CHUNK = 50;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await db.batch(updates.slice(i, i + CHUNK));
  }

  const last = results[results.length - 1]!;
  return {
    scanned: results.length,
    updated,
    done: results.length < batchSize,
    next_after: last.refuse_id,
    duration_ms: Date.now() - startedAt};
}
