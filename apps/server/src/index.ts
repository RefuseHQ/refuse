/**
 * refuse server entrypoint.
 *
 * Boot sequence:
 *   1. Load + validate config (env vars).
 *   2. Open SQLite + run pending migrations.
 *   3. Build the Hono app.
 *   4. Start node-cron scheduler (added in a follow-up task).
 *   5. Listen on REFUSE_PORT.
 *
 * Graceful shutdown closes the DB on SIGINT/SIGTERM so the WAL doesn't get
 * truncated mid-write.
 */

import { serve } from "@hono/node-server";
import { loadConfig } from "./config";
import { openDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { adapt } from "./db/adapter";
import { makeCardReader } from "./cards";
import { buildApp } from "./http/router";
import { buildScheduler } from "./ingest/scheduler";

function main(): void {
  const config = loadConfig();
  const db = openDb(config.REFUSE_DB_PATH);
  runMigrations(db);

  const cards = makeCardReader(db, {
    maxEntries: config.REFUSE_CARD_CACHE_SIZE,
    ttlSeconds: config.REFUSE_CARD_CACHE_TTL_SECONDS,
  });

  const dbFacade = adapt(db);
  const scheduler = buildScheduler(db, config, {
    db: dbFacade,
    cards,
    ...(config.REFUSE_GITHUB_TOKEN !== undefined ? { githubToken: config.REFUSE_GITHUB_TOKEN } : {}),
  });
  scheduler.start();

  const app = buildApp({ db, config, cards, scheduler });

  const server = serve({
    fetch: app.fetch,
    port: config.REFUSE_PORT,
    hostname: "0.0.0.0",
  });

  console.log(
    `refuse: listening on http://0.0.0.0:${config.REFUSE_PORT}` +
      ` (db ${config.REFUSE_DB_PATH}, require_key=${config.REFUSE_REQUIRE_KEY})`,
  );

  const shutdown = (signal: string): void => {
    console.log(`refuse: ${signal} received, shutting down`);
    scheduler.stop();
    server.close(() => {
      try {
        db.close();
      } catch {
        // ignore — best-effort close
      }
      process.exit(0);
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
