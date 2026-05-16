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
 */

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
/**
 * Wall-clock budget per cron run. The npm zip is ~200 MB compressed and the
 * delta from a cold watermark is tens of thousands of records — far more than
 * one invocation can handle. We process a slice each run, persist the
 * watermark, and rely on the rotation cursor to resume here next tick.
 * Bounded to leave headroom under the Workers Paid CPU cap (5 min).
 */
const OSV_RUN_BUDGET_MS = 60 * 1000;

export async function runOsvDelta(db: D1LikeDatabase, cards: CardReader): Promise<void> {
  const osv = createOsvFetcher();
  const stateRow = await db
    .prepare(`SELECT last_modified FROM ingestion_state WHERE source = 'osv'`)
    .first<{ last_modified: string | null }>();
  const cursor = parseCursor(stateRow?.last_modified ?? null);

  const ecosystem = ROTATION[cursor.next_index % ROTATION.length]!;
  const watermark = cursor.watermarks[ecosystem] ?? "1970-01-01T00:00:00Z";

  let processed = 0;
  const allChanged = new Map<string, AffectedKey>();
  let newWatermark = watermark;
  const startedAt = Date.now();

  const buffer: ReturnType<typeof normalizeOsv>[] = [];
  const flush = async (): Promise<void> => {
    const batch = buffer.filter((b): b is NonNullable<typeof b> => b !== null);
    buffer.length = 0;
    if (batch.length === 0) return;
    const result = await upsertRecords(db, batch);
    processed += result.vulnerabilities_written;
    for (const k of result.affected_pairs_changed) {
      allChanged.set(`${k.ecosystem}::${k.package_name}`, k);
    }
  };

  try {
    const body = await osv.openEcosystemArchive(ecosystem);
    // OSV stopped publishing this ecosystem (typically a distro after EOL).
    // Skip it, advance the rotation, and record ok — otherwise the cron gets
    // stuck retrying the same dead URL every 5 min forever and `last_ok_at`
    // never advances, tripping status-page warnings.
    if (body === null) {
      const skipCursor: OsvCursor = {
        next_index: (cursor.next_index + 1) % ROTATION.length,
        watermarks: cursor.watermarks};
      await recordIngestionState(db, "osv", "ok", 0, {
        lastModified: JSON.stringify(skipCursor),
        error: `${ecosystem}: archive 404 (skipped)`});
      return;
    }
    const { stopped } = await streamZipRecords(body, {
      shouldStop: () => Date.now() - startedAt > OSV_RUN_BUDGET_MS,
      onRecord: async ({ record }) => {
        if (record.modified <= watermark) return;
        const norm = normalizeOsv(record);
        if (!norm) return;
        buffer.push(norm);
        if (record.modified > newWatermark) newWatermark = record.modified;
        if (buffer.length >= OSV_FLUSH_AT) await flush();
      }});
    await flush();

    // Cap card republishing per tick. Each card costs ~5 subrequests
    // (3 D1 reads + 1 KV read + 1 KV write) and the worker has a
    // 1000-subrequest hard cap per invocation. Beyond this many we'd
    // bust the cap on the closing recordIngestionState write. Anything
    // not republished here gets picked up by the next cron tick or the
    // daily card recompute.
    const CARDS_PER_TICK = 50;
    const changedList = Array.from(allChanged.values());
    if (changedList.length > 0) {
      await publishCards(
        db,
        cards,
        changedList.slice(0, CARDS_PER_TICK),
        { concurrency: 16 },
      );
    }

    // If we exited on the time budget, leave next_index pointing back at this
    // ecosystem so the next cron tick resumes from the same watermark.
    const advance = stopped ? 0 : 1;
    const nextCursor: OsvCursor = {
      next_index: (cursor.next_index + advance) % ROTATION.length,
      watermarks: { ...cursor.watermarks, [ecosystem]: newWatermark }};
    await recordIngestionState(db, "osv", "ok", processed, {
      lastModified: JSON.stringify(nextCursor)});
  } catch (e) {
    // Try to flush whatever made it through before the failure so we don't
    // re-process those records on the next run.
    try {
      await flush();
    } catch {
      // ignore secondary failure
    }
    const persistedCursor: OsvCursor = {
      next_index: cursor.next_index,
      watermarks: { ...cursor.watermarks, [ecosystem]: newWatermark }};
    await recordIngestionState(db, "osv", "error", processed, {
      error: `${ecosystem}: ${(e as Error).message}`,
      lastModified: JSON.stringify(persistedCursor)});
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

  let processed = 0;
  const changed: AffectedKey[] = [];
  const failures: string[] = [];
  const FAILURE_LIMIT = 50;

  for (const { ecosystem, package_name } of targets) {
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

  try {
    const r = await refreshKev(db);
    console.log(`KEV: fetched=${r.fetched} upserted=${r.upserted}`);
  } catch (e) {
    errors.push(`KEV: ${(e as Error).message}`);
  }

  try {
    const r = await refreshEpss(db);
    console.log(`EPSS: fetched=${r.fetched} upserted=${r.upserted} date=${r.scored_date}`);
  } catch (e) {
    errors.push(`EPSS: ${(e as Error).message}`);
  }

  try {
    const stateRow = await db
      .prepare(`SELECT last_modified FROM ingestion_state WHERE source = 'ghsa_direct'`)
      .first<{ last_modified: string | null }>();
    const cursor = stateRow?.last_modified ?? undefined;
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
    console.log(`GHSA direct: imported=${records.length}`);
  } catch (e) {
    errors.push(`GHSA direct: ${(e as Error).message}`);
  }

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
    console.log(`Wolfi: packages=${stats.packages} records=${stats.records}`);
  } catch (e) {
    errors.push(`Wolfi: ${(e as Error).message}`);
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
