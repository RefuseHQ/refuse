import { publishCards } from "./publish-cards";

import type { D1LikeDatabase, D1Statement } from "../db/adapter";
import type { CardReader } from "../cards";
export interface RecomputeCardsResult {
  scanned: number;
  written: number;
  deleted: number;
  errors: number;
  done: boolean;
  next_after: { ecosystem: string; package_name: string } | null;
  duration_ms: number;
}

/**
 * Republish all KV cards over distinct (ecosystem, package_name) pairs from
 * affected_packages. Used after a global recompute (e.g., severity fix) so
 * the read path reflects the new D1 values. Cursor-paginated by
 * `(ecosystem, package_name)` lexicographically.
 */
export async function recomputeCards(
  db: D1LikeDatabase,
  kv: CardReader,
  opts: {
    batchSize?: number;
    afterEcosystem?: string;
    afterName?: string;
  } = {},
): Promise<RecomputeCardsResult> {
  const startedAt = Date.now();
  const batchSize = Math.min(Math.max(opts.batchSize ?? 100, 1), 500);
  const afterEcosystem = opts.afterEcosystem ?? "";
  const afterName = opts.afterName ?? "";

  const rows = await db
    .prepare(
      `SELECT DISTINCT ecosystem, package_name FROM affected_packages
       WHERE (ecosystem > ?)
          OR (ecosystem = ? AND package_name > ?)
       ORDER BY ecosystem ASC, package_name ASC LIMIT ?`,
    )
    .bind(afterEcosystem, afterEcosystem, afterName, batchSize)
    .all<{ ecosystem: string; package_name: string }>();

  const results = rows.results ?? [];
  if (results.length === 0) {
    return {
      scanned: 0,
      written: 0,
      deleted: 0,
      errors: 0,
      done: true,
      next_after: null,
      duration_ms: Date.now() - startedAt};
  }

  const r = await publishCards(db, kv, results, { concurrency: 32 });
  const last = results[results.length - 1]!;
  return {
    scanned: results.length,
    written: r.written,
    deleted: r.deleted,
    errors: r.errors.length,
    done: results.length < batchSize,
    next_after: { ecosystem: last.ecosystem, package_name: last.package_name },
    duration_ms: Date.now() - startedAt};
}
