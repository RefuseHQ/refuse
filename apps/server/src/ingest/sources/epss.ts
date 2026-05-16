import type { D1LikeDatabase, D1Statement } from "../../db/adapter";
/**
 * EPSS (Exploit Prediction Scoring System) — for each CVE, the modeled
 * probability (0..1) it will be exploited in the next 30 days, plus a
 * percentile ranking. Updated daily by FIRST.org.
 *
 * Bulk download: https://epss.cyentia.com/epss_scores-current.csv.gz
 * (~250K rows, ~6 MB compressed). Format:
 *   #model_version: v2025.x.x, score_date: YYYY-MM-DD
 *   cve,epss,percentile
 *   CVE-2021-44228,0.97543,0.99987
 *
 * The bulk file is small enough to stream-decompress in a Worker without
 * blowing memory.
 */

import { gunzipSync } from "fflate";

const EPSS_URL = "https://epss.cyentia.com/epss_scores-current.csv.gz";

export interface EpssRefreshResult {
  fetched: number;
  upserted: number;
  scored_date: string | null;
}

export async function refreshEpss(db: D1LikeDatabase): Promise<EpssRefreshResult> {
  const res = await fetch(EPSS_URL, {});
  if (!res.ok) throw new Error(`EPSS fetch ${res.status}`);
  const gz = new Uint8Array(await res.arrayBuffer());
  const csvBytes = gunzipSync(gz);
  const csv = new TextDecoder("utf-8").decode(csvBytes);
  const lines = csv.split("\n");
  let scored_date: string | null = null;

  // Header pragmas: `#model_version:..., score_date: 2026-04-27`
  for (const line of lines) {
    if (line.startsWith("#")) {
      const m = /score_date:\s*([\d-]+)/.exec(line);
      if (m) scored_date = m[1] ?? null;
      continue;
    }
    if (line.startsWith("cve,")) break;
  }

  const upsertSql = `
    INSERT INTO epss (cve_id, score, percentile, scored_date, fetched_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(cve_id) DO UPDATE SET
      score       = excluded.score,
      percentile  = excluded.percentile,
      scored_date = excluded.scored_date,
      fetched_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `;

  // The full feed is ~330K rows. Run modest 50-stmt batches with bounded
  // concurrency — keeps each statement light enough for D1's CPU budget
  // while parallelism keeps wall time under the 5-min fetch limit. Larger
  // batches busted the per-statement CPU cap (CF error 1102).
  const CHUNK = 50;
  const batches: D1Statement[][] = [];
  let current: D1Statement[] = [];
  let fetched = 0;
  for (const line of lines) {
    if (!line || line.startsWith("#") || line.startsWith("cve,")) continue;
    const [cve, scoreStr, percentileStr] = line.split(",");
    if (!cve || !scoreStr || !percentileStr) continue;
    const score = Number(scoreStr);
    const percentile = Number(percentileStr);
    if (Number.isNaN(score) || Number.isNaN(percentile)) continue;
    fetched++;
    current.push(
      db.prepare(upsertSql).bind(cve, score, percentile, scored_date ?? null),
    );
    if (current.length >= CHUNK) {
      batches.push(current);
      current = [];
    }
  }
  if (current.length > 0) batches.push(current);

  const CONCURRENCY = 8;
  let upserted = 0;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= batches.length) return;
      try {
        await db.batch(batches[i]!);
        upserted += batches[i]!.length;
      } catch {
        // Best-effort — skip a chunk on transient failures.
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()),
  );

  return { fetched, upserted, scored_date };
}
