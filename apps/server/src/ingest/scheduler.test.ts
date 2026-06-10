import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { buildScheduler } from "./scheduler";
import { runMigrations } from "../db/migrate";
import { adapt } from "../db/adapter";
import { makeCardReader } from "../cards";
import type { Config } from "../config";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    REFUSE_PORT: 8080,
    REFUSE_DB_PATH: ":memory:",
    REFUSE_REQUIRE_KEY: false,
    REFUSE_ADMIN_TOKEN: undefined,
    REFUSE_GITHUB_TOKEN: undefined,
    REFUSE_CORS_ORIGIN: "*",
    REFUSE_OSV_FREQUENCY: 5,
    REFUSE_DEPS_DEV_FREQUENCY: 15,
    REFUSE_ENRICHMENT_CRON: "0 5 * * *",
    REFUSE_DISABLE_INGEST: true, // tests never want real cron tasks running
    REFUSE_BOOTSTRAP_ON_EMPTY: false,
    REFUSE_CARD_CACHE_SIZE: 1000,
    REFUSE_CARD_CACHE_TTL_SECONDS: 60,
    ...overrides,
  } as Config;
}

function makeScheduler(overrides: Partial<Config> = {}) {
  const db = new Database(":memory:");
  runMigrations(db);
  const config = makeConfig(overrides);
  const cards = makeCardReader(db, { maxEntries: 1000, ttlSeconds: 60 });
  const scheduler = buildScheduler(db, config, { db: adapt(db), cards });
  return { db, scheduler };
}

function markSourceOk(db: Database.Database, source: string, lastModified: string | null = null): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO ingestion_state (source, last_modified, last_run_at, last_status, last_error, last_ok_at, records_processed)
     VALUES (?, ?, ?, 'ok', NULL, ?, 0)
     ON CONFLICT(source) DO UPDATE SET
       last_modified = excluded.last_modified,
       last_run_at = excluded.last_run_at,
       last_ok_at = excluded.last_ok_at,
       last_status = 'ok'`,
  ).run(source, lastModified, now, now);
}

describe("buildScheduler — readiness", () => {
  it("reports not-ready with all required sources pending on a fresh DB", () => {
    const { scheduler } = makeScheduler();
    const snap = scheduler.getReadiness();
    expect(snap.ready).toBe(false);
    expect(snap.ready_sources).toEqual([]);
    expect(snap.pending_sources).toEqual(["osv", "kev", "epss", "ghsa_direct", "wolfi"]);
    expect(snap.osv_ecosystems_done).toBe(0);
    expect(snap.osv_ecosystems_total).toBeGreaterThan(20); // 28 today, doesn't matter exactly
  });

  it("counts a source as ready once it has a last_ok_at", () => {
    const { db, scheduler } = makeScheduler();
    markSourceOk(db, "kev");
    const snap = scheduler.getReadiness();
    expect(snap.ready).toBe(false);
    expect(snap.ready_sources).toEqual(["kev"]);
    expect(snap.pending_sources).toEqual(["osv", "epss", "ghsa_direct", "wolfi"]);
  });

  it("reports ready=true when every required source has a last_ok_at", () => {
    const { db, scheduler } = makeScheduler();
    for (const s of ["osv", "kev", "epss", "ghsa_direct", "wolfi"]) markSourceOk(db, s);
    const snap = scheduler.getReadiness();
    expect(snap.ready).toBe(true);
    expect(snap.pending_sources).toEqual([]);
  });

  it("counts OSV per-ecosystem progress from the cursor watermarks", () => {
    const { db, scheduler } = makeScheduler();
    const cursor = JSON.stringify({
      next_index: 3,
      watermarks: {
        npm: "2026-06-10T00:00:00Z",
        PyPI: "2026-06-10T00:00:00Z",
        Maven: "2026-06-10T00:00:00Z",
      },
    });
    markSourceOk(db, "osv", cursor);
    const snap = scheduler.getReadiness();
    expect(snap.osv_ecosystems_done).toBe(3);
  });

  it("does not crash when ingestion_state.last_modified is not valid JSON", () => {
    const { db, scheduler } = makeScheduler();
    markSourceOk(db, "osv", "not json at all");
    const snap = scheduler.getReadiness();
    expect(snap.osv_ecosystems_done).toBe(0);
  });
});
