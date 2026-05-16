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
 * Optionally, on first boot with an empty DB, kicks one synchronous OSV pass
 * so `docker run` becomes useful within minutes instead of waiting for the
 * first cron tick.
 */

import cron, { type ScheduledTask } from "node-cron";
import type Database from "better-sqlite3";
import type { Config } from "../config";
import type { CardReader } from "../cards";
import type { D1LikeDatabase } from "../db/adapter";
import { runOsvDelta, runDepsDevRefresh, runDailyEnrichment } from "./cron";

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

export interface Scheduler {
  start(): void;
  stop(): void;
  /** Manually trigger a job (used by admin endpoints). */
  trigger(job: "osv" | "deps-dev" | "enrichment"): Promise<void>;
}

export function buildScheduler(
  rawDb: Database.Database,
  config: Config,
  deps: JobDeps,
): Scheduler {
  const osvJob = makeJob("osv-delta", () => runOsvDelta(deps.db, deps.cards));
  const depsDevJob = makeJob("deps-dev", () => runDepsDevRefresh(deps.db, deps.cards));
  const enrichJob = makeJob("enrichment", () =>
    runDailyEnrichment(deps.db, deps.cards, deps.githubToken !== undefined ? { GITHUB_TOKEN: deps.githubToken } : {}),
  );

  const tasks: ScheduledTask[] = [];

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

      // First-boot bootstrap: if the vulnerabilities table is empty, kick a
      // synchronous OSV pass so the server has something to serve within
      // minutes instead of waiting up to REFUSE_OSV_FREQUENCY for the first
      // tick.
      if (config.REFUSE_BOOTSTRAP_ON_EMPTY) {
        const row = rawDb
          .prepare(`SELECT COUNT(*) AS n FROM vulnerabilities`)
          .get() as { n: number } | undefined;
        if (!row || row.n === 0) {
          console.log("refuse: empty vulnerabilities table — kicking initial OSV pass");
          osvJob().catch(() => {}); // fire-and-forget; logged inside makeJob
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
  };
}
