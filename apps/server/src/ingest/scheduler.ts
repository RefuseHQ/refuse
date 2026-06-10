/**
 * In-process cron scheduler. Runs three jobs:
 *
 *   OSV delta            every REFUSE_OSV_FREQUENCY minutes (default 5)
 *   deps.dev refresh     every REFUSE_DEPS_DEV_FREQUENCY minutes (default 15)
 *   daily enrichment     at REFUSE_ENRICHMENT_CRON (default 5am UTC)
 *
 * Each job is wrapped with a concurrency guard so a long-running tick doesn't
 * overlap with the next. Errors are caught and logged; the scheduler never
 * crashes the process.
 *
 * Optionally, on first boot with an empty DB, kicks all three jobs in parallel
 * so `docker run` becomes useful within minutes instead of waiting for the
 * first cron tick. Emits a per-source progress banner and exposes a readiness
 * snapshot the HTTP /readyz route polls.
 */

import cron, { type ScheduledTask } from "node-cron";
import type Database from "better-sqlite3";
import { LANGUAGE_ECOSYSTEMS, CI_ECOSYSTEMS } from "@refuse/shared";
import type { Config } from "../config";
import type { CardReader } from "../cards";
import type { D1LikeDatabase } from "../db/adapter";
import { runOsvDelta, runOsvBootstrap, runDepsDevRefresh, runDailyEnrichment } from "./cron";

interface JobDeps {
  db: D1LikeDatabase;
  cards: CardReader;
  githubToken?: string;
}

type JobFn = () => Promise<void>;

function makeJob(name: string, fn: JobFn): JobFn {
  let running = false;
  return async () => {
    if (running) {
      console.warn(`refuse: ${name} skipped — previous run still in progress`);
      return;
    }
    running = true;
    const startedAt = Date.now();
    try {
      await fn();
      console.log(`refuse: ${name} ok in ${Date.now() - startedAt} ms`);
    } catch (e) {
      console.error(`refuse: ${name} failed (${Date.now() - startedAt} ms):`, (e as Error).message);
    } finally {
      running = false;
    }
  };
}

/**
 * Sources that gate "ready". OSV alone covers most package ecosystems, but the
 * KEV / EPSS enrichment is what gates "this is a real exploitation signal"
 * from the API responses — without them the /api/v1/check responses are
 * structurally complete but missing actively-exploited and likelihood scoring.
 * deps.dev is metadata-only (version freshness) so it isn't required for
 * readiness, but we surface its state in the snapshot.
 */
const REQUIRED_SOURCES = ["osv", "kev", "epss", "ghsa_direct", "wolfi"] as const;
const OSV_ROTATION_TOTAL = LANGUAGE_ECOSYSTEMS.length + CI_ECOSYSTEMS.length + 17; // DISTRO_ROTATION

export interface ReadinessSnapshot {
  ready: boolean;
  /** Sources that have completed at least one successful run. */
  ready_sources: string[];
  /** Sources that haven't completed yet. */
  pending_sources: string[];
  /** OSV per-ecosystem progress: how many of the 28 archives have been processed at least once. */
  osv_ecosystems_done: number;
  osv_ecosystems_total: number;
}

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Manually trigger a job (used by admin endpoints). */
  trigger(job: "osv" | "deps-dev" | "enrichment"): Promise<void>;
  /** Snapshot of which sources have completed an initial pass. */
  getReadiness(): ReadinessSnapshot;
}

function readSourcesDone(rawDb: Database.Database): Set<string> {
  const done = new Set<string>();
  try {
    const rows = rawDb
      .prepare(`SELECT source, last_ok_at FROM ingestion_state WHERE last_ok_at IS NOT NULL`)
      .all() as { source: string; last_ok_at: string | null }[];
    for (const r of rows) done.add(r.source);
  } catch {
    // ingestion_state may not exist yet during startup — treat as empty.
  }
  return done;
}

function readOsvEcosystemsDone(rawDb: Database.Database): number {
  try {
    const row = rawDb
      .prepare(`SELECT last_modified FROM ingestion_state WHERE source = 'osv'`)
      .get() as { last_modified: string | null } | undefined;
    if (!row?.last_modified) return 0;
    const parsed = JSON.parse(row.last_modified) as { watermarks?: Record<string, string> };
    return Object.keys(parsed.watermarks ?? {}).length;
  } catch {
    return 0;
  }
}

export function buildScheduler(
  rawDb: Database.Database,
  config: Config,
  deps: JobDeps,
): Scheduler {
  const osvJob = makeJob("osv-delta", () =>
    runOsvDelta(deps.db, deps.cards, { concurrency: config.REFUSE_OSV_CONCURRENCY }),
  );
  const osvBulkJob = makeJob("osv-bulk", () => runOsvBootstrap(deps.db, deps.cards));
  const depsDevJob = makeJob("deps-dev", () => runDepsDevRefresh(deps.db, deps.cards));
  const enrichJob = makeJob("enrichment", () =>
    runDailyEnrichment(deps.db, deps.cards, deps.githubToken !== undefined ? { GITHUB_TOKEN: deps.githubToken } : {}),
  );

  const tasks: ScheduledTask[] = [];

  function readinessSnapshot(): ReadinessSnapshot {
    const done = readSourcesDone(rawDb);
    const ready_sources: string[] = [];
    const pending_sources: string[] = [];
    for (const s of REQUIRED_SOURCES) {
      (done.has(s) ? ready_sources : pending_sources).push(s);
    }
    return {
      ready: pending_sources.length === 0,
      ready_sources,
      pending_sources,
      osv_ecosystems_done: readOsvEcosystemsDone(rawDb),
      osv_ecosystems_total: OSV_ROTATION_TOTAL,
    };
  }

  return {
    start(): void {
      if (config.REFUSE_DISABLE_INGEST) {
        console.log("refuse: ingestion disabled (REFUSE_DISABLE_INGEST=true)");
        return;
      }
      tasks.push(
        cron.schedule(`*/${config.REFUSE_OSV_FREQUENCY} * * * *`, osvJob),
        cron.schedule(`*/${config.REFUSE_DEPS_DEV_FREQUENCY} * * * *`, depsDevJob),
        cron.schedule(config.REFUSE_ENRICHMENT_CRON, enrichJob),
      );
      console.log(
        `refuse: cron started — osv every ${config.REFUSE_OSV_FREQUENCY}m, deps.dev every ${config.REFUSE_DEPS_DEV_FREQUENCY}m, enrichment "${config.REFUSE_ENRICHMENT_CRON}"`,
      );

      // First-boot bootstrap: kick each job whose source has never completed
      // a successful run. Decoupling per-source means an upgrade from an
      // older image — where OSV ran but the enrichment cron hasn't fired yet
      // — still backfills KEV/EPSS/GHSA/Wolfi instead of waiting up to 24h.
      // Each job runs under its own concurrency guard so the regular cron
      // tick that fires later just no-ops.
      if (config.REFUSE_BOOTSTRAP_ON_EMPTY) {
        const done = readSourcesDone(rawDb);
        const enrichmentSources = ["kev", "epss", "ghsa_direct", "wolfi"] as const;
        const missingEnrichment = enrichmentSources.filter((s) => !done.has(s));

        const kicks: string[] = [];
        if (!done.has("osv")) {
          // First boot: use the bulk all.zip — pulls every ecosystem in
          // one streaming download. ~200 MB compressed, ~2-3 min total —
          // ~50× faster than walking the 26-ecosystem rotation at 1/tick.
          kicks.push("osv:bulk (all ecosystems in one pass)");
          osvBulkJob().catch(() => {});
        }
        if (!done.has("deps_dev")) {
          kicks.push("deps-dev");
          depsDevJob().catch(() => {});
        }
        if (missingEnrichment.length > 0) {
          kicks.push(`enrichment(${missingEnrichment.join(",")})`);
          enrichJob().catch(() => {});
        }
        if (kicks.length > 0) {
          console.log(
            `refuse: bootstrap — kicking ${kicks.join(" + ")} in parallel. Watch /readyz for progress.`,
          );
        }
      }
    },
    stop(): void {
      for (const t of tasks) t.stop();
      tasks.length = 0;
    },
    async trigger(job): Promise<void> {
      if (job === "osv") return osvJob();
      if (job === "deps-dev") return depsDevJob();
      return enrichJob();
    },
    getReadiness: readinessSnapshot,
  };
}
