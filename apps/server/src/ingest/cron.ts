import {
  LANGUAGE_ECOSYSTEMS,
  CI_ECOSYSTEMS} from "@refuse/shared";
import { createOsvFetcher, streamZipRecords } from "./sources/osv";
import { createDepsDevFetcher, pickLatest } from "./sources/deps-dev";
import { refreshKev } from "./sources/kev";
import { refreshEpss } from "./sources/epss";
import { pullGhsaPage } from "./sources/ghsa-direct";
import { pullWolfi } from "./sources/wolfi";
import { normalizeOsv } from "./normalize";
import { upsertRecords, recordIngestionState, type AffectedKey } from "./upsert";
import { publishCards } from "./publish-cards";

import type { D1LikeDatabase, D1Statement } from "../db/adapter";
import type { CardReader } from "../cards";
/**
 * Cron orchestration. The 5-minute trigger calls `runOsvDelta`; the daily
 * trigger calls `runDepsDevRefresh`.
 *
 * OSV strategy: round-robin across ecosystems (one per cron run), keyed by an
 * index stored in `ingestion_state.last_modified` as `"<ecosystem>|<iso-ts>"`.
 * Each run fetches one ecosystem's archive, processes records whose
 * `modified` timestamp is newer than the per-ecosystem watermark, and updates
 * the watermark.
 *
 * Each ingest step emits structured progress lines so `docker logs` shows a
 * "loading bar" of what's actually happening per source:
 *
 *   refuse: ingest[osv:npm]    ▶ starting (ecosystem 1/28)
 *   refuse: ingest[osv:npm]      5000 records • 12s
 *   refuse: ingest[osv:npm]    ✓ done — 14502 records in 41s
 */

/** Consistent prefix for ingest progress logs — greppable + alignable. */
function logIngest(tag: string, msg: string): void {
  // Pad tag to a fixed width so output columns stay aligned across sources.
  // 18 chars covers "osv:Rocky Linux:9" with room for one more char of slack.
  console.log(`refuse: ingest[${tag.padEnd(18)}] ${msg}`);
}

/** Format an elapsed-ms count as a short string (1.2s / 14s / 1m23s). */
function fmtElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms - m * 60_000) / 1000);
  return `${m}m${s}s`;
}

/**
 * Render a 20-char ASCII progress bar. Pct ∈ [0, 1] is clamped — streaming
 * sources pass an estimated pct that may "stick" near 99% until the source
 * completes; the authoritative final count is shown in the trailing `done`
 * line so the bar is decorative-but-honest rather than misleading.
 */
function bar(pct: number, width = 20): string {
  const clamped = Math.max(0, Math.min(1, pct));
  const filled = Math.round(clamped * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${Math.floor(clamped * 100)
    .toString()
    .padStart(3)}%`;
}

/**
 * Calibrated soft-caps for streaming sources. We don't know how many records
 * a given OSV ecosystem zip will yield until we finish reading it, so we pick
 * a per-ecosystem ceiling that npm-class ecosystems comfortably saturate and
 * smaller ecosystems mark "fast-and-done" against. The bar holds at ~99% if
 * we overshoot the estimate — the `done` line tells the truth.
 */
const OSV_ECOSYSTEM_ESTIMATE: Record<string, number> = {
  npm: 30_000,
  PyPI: 20_000,
  Maven: 15_000,
  Go: 8_000,
  "crates.io": 4_000,
  RubyGems: 3_000,
  NuGet: 4_000,
  Packagist: 2_000,
  Hex: 500,
  Pub: 200,
  "GitHub Actions": 500,
};
const OSV_ECOSYSTEM_ESTIMATE_DEFAULT = 5_000; // distros + anything unseen
const EPSS_ESTIMATE = 280_000;

// Versioned distro identifiers OSV publishes per-ecosystem zips for. These
// expand check_dockerfile coverage to cover apt/apk/dnf packages on the
// respective base images.
const DISTRO_ROTATION = [
  "Debian:11",
  "Debian:12",
  "Debian:13",
  "Ubuntu:20.04",
  "Ubuntu:22.04",
  "Ubuntu:24.04",
  "Alpine:v3.18",
  "Alpine:v3.19",
  "Alpine:v3.20",
  "Alpine:v3.21",
  "Red Hat:9",
  "Rocky Linux:9",
  "AlmaLinux:9",
  "Chainguard",
  "Bitnami",
] as const;

const ROTATION = [
  ...LANGUAGE_ECOSYSTEMS,
  ...CI_ECOSYSTEMS,
  ...DISTRO_ROTATION,
] as const;

/** Cron state cursor lives in ingestion_state.last_modified for source="osv" as JSON. */
interface OsvCursor {
  next_index: number;
  watermarks: Record<string, string>; // ecosystem → ISO timestamp
}

const EMPTY_CURSOR: OsvCursor = { next_index: 0, watermarks: {} };

function parseCursor(raw: string | null): OsvCursor {
  if (!raw) return EMPTY_CURSOR;
  try {
    const parsed = JSON.parse(raw) as Partial<OsvCursor>;
    return {
      next_index: typeof parsed.next_index === "number" ? parsed.next_index : 0,
      watermarks: parsed.watermarks ?? {}};
  } catch {
    return EMPTY_CURSOR;
  }
}

/** Flush every N normalized records into D1 to keep memory bounded. */
const OSV_FLUSH_AT = 80;
/** Default ecosystems fetched in parallel per delta tick. Overridable via REFUSE_OSV_CONCURRENCY. */
export const OSV_DEFAULT_CONCURRENCY = 4;

interface EcosystemPassResult {
  ecosystem: string;
  processed: number;
  newWatermark: string;
  affected: AffectedKey[];
  skipped404: boolean;
  error?: string;
}

/**
 * Pull one ecosystem's per-ecosystem zip, apply watermark, upsert records, and
 * return aggregated stats. No wall-clock budget — designed for a self-hosted
 * Node runtime that doesn't need the old Worker CPU cap. The caller decides
 * concurrency by spawning multiple invocations.
 */
async function processOsvEcosystem(
  db: D1LikeDatabase,
  osv: ReturnType<typeof createOsvFetcher>,
  ecosystem: string,
  initialWatermark: string,
): Promise<EcosystemPassResult> {
  const tag = `osv:${ecosystem}`;
  const startedAt = Date.now();
  let processed = 0;
  let lastReportedAt = 0;
  let newWatermark = initialWatermark;
  const affected = new Map<string, AffectedKey>();
  const buffer: ReturnType<typeof normalizeOsv>[] = [];
  const flush = async (): Promise<void> => {
    const batch = buffer.filter((b): b is NonNullable<typeof b> => b !== null);
    buffer.length = 0;
    if (batch.length === 0) return;
    const result = await upsertRecords(db, batch);
    processed += result.vulnerabilities_written;
    for (const k of result.affected_pairs_changed) {
      affected.set(`${k.ecosystem}::${k.package_name}`, k);
    }
    if (Date.now() - lastReportedAt >= 5000) {
      const est = OSV_ECOSYSTEM_ESTIMATE[ecosystem] ?? OSV_ECOSYSTEM_ESTIMATE_DEFAULT;
      logIngest(tag, `${bar(processed / est)} • ${processed} records • ${fmtElapsed(startedAt)}`);
      lastReportedAt = Date.now();
    }
  };

  const body = await osv.openEcosystemArchive(ecosystem);
  if (body === null) {
    logIngest(tag, `· archive 404 — ecosystem skipped`);
    return {
      ecosystem,
      processed: 0,
      newWatermark: initialWatermark,
      affected: [],
      skipped404: true,
    };
  }

  await streamZipRecords(body, {
    onRecord: async ({ record }) => {
      if (record.modified <= initialWatermark) return;
      const norm = normalizeOsv(record);
      if (!norm) return;
      buffer.push(norm);
      if (record.modified > newWatermark) newWatermark = record.modified;
      if (buffer.length >= OSV_FLUSH_AT) await flush();
    },
  });
  await flush();

  logIngest(tag, `✓ done — ${processed} records in ${fmtElapsed(startedAt)}`);
  return {
    ecosystem,
    processed,
    newWatermark,
    affected: Array.from(affected.values()),
    skipped404: false,
  };
}

/**
 * Delta refresh across all ecosystems, run in parallel with a soft concurrency
 * cap. Replaces the previous "1 ecosystem per 5-min tick under a 60s budget"
 * design that was a workaround for the Workers CPU cap — self-hosted Node has
 * neither limit, so we just pull everything every tick. After the first
 * bootstrap, deltas are small (per-ecosystem watermark filtering rejects most
 * records before normalization).
 */
export async function runOsvDelta(
  db: D1LikeDatabase,
  cards: CardReader,
  opts: { concurrency?: number } = {},
): Promise<void> {
  const osv = createOsvFetcher();
  const concurrency = Math.max(1, opts.concurrency ?? OSV_DEFAULT_CONCURRENCY);

  const stateRow = await db
    .prepare(`SELECT last_modified FROM ingestion_state WHERE source = 'osv'`)
    .first<{ last_modified: string | null }>();
  const cursor = parseCursor(stateRow?.last_modified ?? null);

  logIngest(
    "osv:delta",
    `▶ starting (${ROTATION.length} ecosystems, concurrency=${concurrency})`,
  );
  const startedAt = Date.now();

  const queue = [...ROTATION];
  const watermarks = { ...cursor.watermarks };
  const allAffected = new Map<string, AffectedKey>();
  let totalProcessed = 0;
  const errors: string[] = [];

  const worker = async (): Promise<void> => {
    for (;;) {
      const ecosystem = queue.shift();
      if (!ecosystem) return;
      const initial = watermarks[ecosystem] ?? "1970-01-01T00:00:00Z";
      try {
        const r = await processOsvEcosystem(db, osv, ecosystem, initial);
        watermarks[ecosystem] = r.newWatermark;
        totalProcessed += r.processed;
        for (const k of r.affected) {
          allAffected.set(`${k.ecosystem}::${k.package_name}`, k);
        }
      } catch (e) {
        const msg = (e as Error).message;
        errors.push(`${ecosystem}: ${msg}`);
        logIngest(`osv:${ecosystem}`, `✗ ${msg}`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const affectedList = Array.from(allAffected.values());
  if (affectedList.length > 0) {
    await publishCards(db, cards, affectedList, { concurrency: 16 });
  }

  const nextCursor: OsvCursor = { next_index: 0, watermarks };
  await recordIngestionState(db, "osv", errors.length ? "error" : "ok", totalProcessed, {
    lastModified: JSON.stringify(nextCursor),
    ...(errors.length ? { error: errors.slice(0, 3).join(" | ") } : {}),
  });

  logIngest(
    "osv:delta",
    `✓ done — ${totalProcessed} records across ${ROTATION.length} ecosystems in ${fmtElapsed(startedAt)}${errors.length ? ` (${errors.length} ecosystem errors)` : ""}`,
  );
}

/**
 * Bulk first-boot seed: stream OSV's `all.zip` (every ecosystem in one file)
 * and upsert everything in a single pass. ~200 MB compressed download, but
 * we process records as the zip streams so the resident set stays bounded
 * by `OSV_FLUSH_AT`. Per-ecosystem watermarks get populated from each record's
 * `affected[].package.ecosystem`, so the subsequent `runOsvDelta` ticks know
 * exactly what's already loaded.
 *
 * Only called when OSV's `ingestion_state` row has never been recorded —
 * subsequent runs use the much smaller per-ecosystem deltas.
 */
export async function runOsvBootstrap(
  db: D1LikeDatabase,
  cards: CardReader,
): Promise<void> {
  const osv = createOsvFetcher();
  const tag = "osv:bulk";
  const startedAt = Date.now();
  logIngest(tag, "▶ starting (downloading OSV all.zip — every ecosystem)");

  let processed = 0;
  let lastReportedAt = 0;
  const watermarks: Record<string, string> = {};
  const allAffected = new Map<string, AffectedKey>();
  const buffer: ReturnType<typeof normalizeOsv>[] = [];

  const flush = async (): Promise<void> => {
    const batch = buffer.filter((b): b is NonNullable<typeof b> => b !== null);
    buffer.length = 0;
    if (batch.length === 0) return;
    const result = await upsertRecords(db, batch);
    processed += result.vulnerabilities_written;
    for (const k of result.affected_pairs_changed) {
      allAffected.set(`${k.ecosystem}::${k.package_name}`, k);
    }
    if (Date.now() - lastReportedAt >= 5000) {
      // Bulk archive yields ~150K records; scale the bar against that.
      logIngest(tag, `${bar(processed / 150_000)} • ${processed} records • ${fmtElapsed(startedAt)}`);
      lastReportedAt = Date.now();
    }
  };

  try {
    const body = await osv.openAllArchive();
    await streamZipRecords(body, {
      onRecord: async ({ record }) => {
        const norm = normalizeOsv(record);
        if (!norm) return;
        buffer.push(norm);
        for (const aff of record.affected ?? []) {
          const eco = aff.package?.ecosystem;
          if (!eco) continue;
          const prev = watermarks[eco] ?? "1970-01-01T00:00:00Z";
          if (record.modified > prev) watermarks[eco] = record.modified;
        }
        if (buffer.length >= OSV_FLUSH_AT) await flush();
      },
    });
    await flush();

    const affectedList = Array.from(allAffected.values());
    if (affectedList.length > 0) {
      logIngest(tag, `→ publishing ${affectedList.length} card updates`);
      await publishCards(db, cards, affectedList, { concurrency: 16 });
    }

    const nextCursor: OsvCursor = { next_index: 0, watermarks };
    await recordIngestionState(db, "osv", "ok", processed, {
      lastModified: JSON.stringify(nextCursor),
    });
    logIngest(
      tag,
      `✓ done — ${processed} records across ${Object.keys(watermarks).length} ecosystems in ${fmtElapsed(startedAt)}`,
    );
  } catch (e) {
    const msg = (e as Error).message;
    try { await flush(); } catch { /* ignore */ }
    await recordIngestionState(db, "osv", "error", processed, {
      error: `bulk bootstrap: ${msg}`,
    });
    logIngest(tag, `✗ failed in ${fmtElapsed(startedAt)}: ${msg}`);
    throw e;
  }
}

/**
 * Per-cron batch size for deps.dev. Each package costs ~2 HTTP calls
 * (versions + license) ≈ 250ms; 400 packages ≈ 100 seconds, comfortably
 * under the worker wall-clock window. Larger batches risk a kill before
 * the cursor + state row gets updated.
 */
const DEPS_DEV_BATCH = 400;

export async function runDepsDevRefresh(db: D1LikeDatabase, cards: CardReader): Promise<void> {
  const fetcher = createDepsDevFetcher();

  // Cursor stored in ingestion_state.last_modified for the deps_dev source.
  // Format: "<ecosystem>|<package_name>" — the position we last processed.
  // Empty / missing => start from the beginning of the alphabet.
  const cursorRow = await db
    .prepare(`SELECT last_modified FROM ingestion_state WHERE source = 'deps_dev'`)
    .first<{ last_modified: string | null }>();
  const cursor = (cursorRow?.last_modified ?? "").split("|");
  const afterEcosystem = cursor[0] ?? "";
  const afterName = cursor[1] ?? "";

  const packagesRes = await db
    .prepare(
      `SELECT DISTINCT ecosystem, package_name FROM affected_packages
       WHERE ecosystem IN ('npm','PyPI','crates.io','Go','Maven','NuGet')
         AND ((ecosystem > ?) OR (ecosystem = ? AND package_name > ?))
       ORDER BY ecosystem ASC, package_name ASC
       LIMIT ?`,
    )
    .bind(afterEcosystem, afterEcosystem, afterName, DEPS_DEV_BATCH)
    .all<{ ecosystem: string; package_name: string }>();
  const targets = packagesRes.results ?? [];

  const depsT0 = Date.now();
  logIngest("deps-dev", `▶ starting (${targets.length} packages in this batch)`);

  let processed = 0;
  let lastDepsReportedAt = 0;
  let pkgIndex = 0;
  const changed: AffectedKey[] = [];
  const failures: string[] = [];
  const FAILURE_LIMIT = 50;

  for (const { ecosystem, package_name } of targets) {
    pkgIndex++;
    if (Date.now() - lastDepsReportedAt >= 5000) {
      logIngest(
        "deps-dev",
        `${bar(pkgIndex / Math.max(1, targets.length))} • ${pkgIndex}/${targets.length} packages • ${fmtElapsed(depsT0)}`,
      );
      lastDepsReportedAt = Date.now();
    }
    try {
      const pkg = await fetcher.getPackageVersions(ecosystem, package_name);
      if (!pkg) continue;

      // Fetch the license for the latest stable version (one extra HTTP call
      // per package) and apply to all versions. License changes between
      // versions are rare enough that broadcasting the latest stable's
      // license to every row is a tolerable approximation in v1.
      const { latest_stable } = pickLatest(pkg);
      let licenseSpdx: string | null = null;
      let licenseCategory: string | null = null;
      if (latest_stable) {
        try {
          const lic = await fetcher.getVersionLicense(ecosystem, package_name, latest_stable);
          if (lic) {
            licenseSpdx = lic.spdx;
            licenseCategory = lic.category;
          }
        } catch {
          // License lookup failures are non-fatal — versions still get written
          // with null license. Card builder treats null as "unknown".
        }
      }

      const stmts: D1Statement[] = [];
      for (const v of pkg.versions) {
        stmts.push(
          db
            .prepare(
              `INSERT INTO package_versions (ecosystem, package_name, version, is_prerelease, is_yanked, released_at, license_spdx, license_category)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ecosystem, package_name, version) DO UPDATE SET
                 is_prerelease    = excluded.is_prerelease,
                 is_yanked        = excluded.is_yanked,
                 released_at      = excluded.released_at,
                 license_spdx     = excluded.license_spdx,
                 license_category = excluded.license_category`,
            )
            .bind(
              ecosystem,
              package_name,
              v.version,
              v.is_prerelease ? 1 : 0,
              v.is_yanked ? 1 : 0,
              v.released_at,
              licenseSpdx,
              licenseCategory,
            ),
        );
      }
      if (stmts.length > 0) {
        await db.batch(stmts);
        processed += stmts.length;
        changed.push({ ecosystem, package_name });
      }
    } catch (e) {
      // deps.dev returns transient 503s for individual packages; one bad
      // package shouldn't abort the whole nightly run. Cap the failure log to
      // keep the error column readable.
      if (failures.length < FAILURE_LIMIT) {
        failures.push(`${ecosystem}/${package_name}: ${(e as Error).message}`);
      }
    }
  }

  if (changed.length > 0) {
    try {
      await publishCards(db, cards, changed);
    } catch (e) {
      failures.push(`publishCards: ${(e as Error).message}`);
    }
  }

  // Per-package failures are recorded in the error column for visibility but
  // the run is still considered ok — a single 503 from deps.dev shouldn't
  // flip the public status page red.
  //
  // Cursor advance: if we processed a full batch, the next run resumes after
  // the last (ecosystem, name). If we processed less than the batch size,
  // we've hit the end of the list — wrap the cursor back to the start so the
  // next run begins a fresh pass.
  const last = targets[targets.length - 1];
  const fullBatch = targets.length === DEPS_DEV_BATCH;
  const nextCursor =
    fullBatch && last ? `${last.ecosystem}|${last.package_name}` : "";

  const errorOpt: { error?: string; lastModified?: string } = {
    lastModified: nextCursor};
  if (failures.length > 0) {
    errorOpt.error = `${failures.length} per-package failures (this batch): ${failures.slice(0, 3).join("; ")}`;
  }
  await recordIngestionState(db, "deps_dev", "ok", processed, errorOpt);
  logIngest(
    "deps-dev",
    `✓ done — ${processed} version rows across ${targets.length} packages in ${fmtElapsed(depsT0)}${failures.length ? ` (${failures.length} per-package failures)` : ""}`,
  );
}

/**
 * Daily enrichment cron — pulls CISA KEV, EPSS scores, GitHub Advisories
 * (direct), and Wolfi advisories. Each is wrapped so one source failing
 * doesn't kill the others.
 */
export async function runDailyEnrichment(
  db: D1LikeDatabase,
  cards: CardReader,
  options: { GITHUB_TOKEN?: string } = {},
): Promise<void> {
  const errors: string[] = [];

  {
    const t0 = Date.now();
    logIngest("kev", "▶ starting");
    try {
      const r = await refreshKev(db);
      await recordIngestionState(db, "kev", "ok", r.upserted);
      logIngest("kev", `${bar(1)} • ${r.upserted}/${r.fetched} entries`);
      logIngest("kev", `✓ done — ${r.upserted} entries in ${fmtElapsed(t0)}`);
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`KEV: ${msg}`);
      await recordIngestionState(db, "kev", "error", 0, { error: msg }).catch(() => {});
      logIngest("kev", `✗ failed in ${fmtElapsed(t0)}: ${msg}`);
    }
  }

  {
    const t0 = Date.now();
    logIngest("epss", "▶ starting");
    try {
      const r = await refreshEpss(db);
      await recordIngestionState(db, "epss", "ok", r.upserted, {
        ...(r.scored_date ? { lastModified: r.scored_date } : {}),
      });
      logIngest("epss", `${bar(r.upserted / EPSS_ESTIMATE)} • ${r.upserted} rows scored ${r.scored_date ?? ""}`);
      logIngest("epss", `✓ done — ${r.upserted} rows in ${fmtElapsed(t0)}`);
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`EPSS: ${msg}`);
      await recordIngestionState(db, "epss", "error", 0, { error: msg }).catch(() => {});
      logIngest("epss", `✗ failed in ${fmtElapsed(t0)}: ${msg}`);
    }
  }

  {
    const t0 = Date.now();
    try {
      const stateRow = await db
        .prepare(`SELECT last_modified FROM ingestion_state WHERE source = 'ghsa_direct'`)
        .first<{ last_modified: string | null }>();
      const cursor = stateRow?.last_modified ?? undefined;
      logIngest("ghsa", `▶ starting (${cursor ? "resuming from saved cursor" : "no prior cursor"})`);
      const { records, cursor: nextCursor } = await pullGhsaPage(
        options.GITHUB_TOKEN,
        100,
        cursor,
      );
      if (records.length > 0) {
        const normalized = records
          .map((r) => normalizeOsv(r))
          .filter((n): n is NonNullable<typeof n> => n !== null);
        const result = await upsertRecords(db, normalized);
        await publishCards(db, cards, result.affected_pairs_changed, {
          concurrency: 16});
      }
      await recordIngestionState(db, "ghsa_direct", "ok", records.length, {
        ...(nextCursor ? { lastModified: nextCursor } : {})});
      logIngest("ghsa", `${bar(records.length / 100)} • ${records.length}/100 records this page`);
      logIngest("ghsa", `✓ done — ${records.length} records in ${fmtElapsed(t0)}${nextCursor ? " (cursor saved)" : " (caught up)"}`);
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`GHSA direct: ${msg}`);
      logIngest("ghsa", `✗ failed in ${fmtElapsed(t0)}: ${msg}`);
    }
  }

  {
    const t0 = Date.now();
    logIngest("wolfi", "▶ starting");
    try {
      const { records, stats } = await pullWolfi();
      if (records.length > 0) {
        const normalized = records
          .map((r) => normalizeOsv(r))
          .filter((n): n is NonNullable<typeof n> => n !== null);
        const result = await upsertRecords(db, normalized);
        await publishCards(db, cards, result.affected_pairs_changed, {
          concurrency: 16});
      }
      await recordIngestionState(db, "wolfi", "ok", records.length);
      logIngest("wolfi", `${bar(1)} • ${stats.packages} packages, ${stats.records} records`);
      logIngest("wolfi", `✓ done — ${stats.records} records across ${stats.packages} packages in ${fmtElapsed(t0)}`);
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(`Wolfi: ${msg}`);
      await recordIngestionState(db, "wolfi", "error", 0, { error: msg }).catch(() => {});
      logIngest("wolfi", `✗ failed in ${fmtElapsed(t0)}: ${msg}`);
    }
  }

  await recordIngestionState(
    db,
    "enrichment",
    errors.length === 0 ? "ok" : "ok",
    0,
    errors.length > 0 ? { error: errors.join(" | ") } : {},
  );
}

/** Re-export so the worker entry stays small. */
export { pickLatest };
