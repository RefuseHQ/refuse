/**
 * In-process smoke test: builds the Hono app, calls a few routes via the
 * Web Request/Response interface (no real network), prints results.
 * Run with: pnpm tsx src/__smoke.ts
 */

import { openDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { buildApp } from "./http/router";
import { loadConfig } from "./config";
import { makeCardReader } from "./cards";

async function main(): Promise<void> {
  const config = loadConfig({
    REFUSE_DB_PATH: "/tmp/refuse-smoke.db",
    REFUSE_PORT: "18080",
    REFUSE_REQUIRE_KEY: "false",
    REFUSE_DISABLE_INGEST: "true",
    REFUSE_BOOTSTRAP_ON_EMPTY: "false",
  });
  const db = openDb(config.REFUSE_DB_PATH);
  runMigrations(db);
  const cards = makeCardReader(db, { maxEntries: 100, ttlSeconds: 60 });

  const app = buildApp({ db, config, cards });

  const hits: Array<[string, RequestInit, number]> = [
    ["http://localhost/healthz", {}, 200],
    ["http://localhost/", {}, 200],
    // Tool routes return 200 with empty-result payloads while the cards reader is stubbed.
    ["http://localhost/api/v1/check/package", { method: "POST", body: JSON.stringify({ ecosystem: "npm", name: "lodash", version: "4.17.10" }), headers: { "Content-Type": "application/json" } }, 200],
    ["http://localhost/api/v1/check/package", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }, 400],
    ["http://localhost/mcp", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }, 501],
    ["http://localhost/api/admin/stats", {}, 503],
    ["http://localhost/nothere", {}, 404],
  ];

  let failed = 0;
  for (const [url, init, expected] of hits) {
    const res = await app.fetch(new Request(url, init));
    const body = await res.text();
    const ok = res.status === expected ? "ok " : "FAIL";
    if (res.status !== expected) failed++;
    console.log(`[${ok}] ${init.method ?? "GET"} ${new URL(url).pathname}  → ${res.status} (expected ${expected})  body: ${body.slice(0, 80)}`);
  }

  // With REFUSE_REQUIRE_KEY=true, /api/v1/* should 401.
  const lockedConfig = loadConfig({
    REFUSE_DB_PATH: "/tmp/refuse-smoke.db",
    REFUSE_PORT: "18080",
    REFUSE_REQUIRE_KEY: "true",
    REFUSE_ADMIN_TOKEN: "test-admin",
  });
  const locked = buildApp({ db, config: lockedConfig, cards });
  const res = await locked.fetch(
    new Request("http://localhost/api/v1/check/package", { method: "POST" }),
  );
  const ok = res.status === 401 ? "ok " : "FAIL";
  if (res.status !== 401) failed++;
  console.log(`[${ok}] POST /api/v1/check/package (key required, no header) → ${res.status} (expected 401)`);

  // /api/admin with right token should be allowed.
  const r2 = await locked.fetch(
    new Request("http://localhost/api/admin/stats", {
      headers: { Authorization: "Bearer test-admin" },
    }),
  );
  const ok2 = r2.status === 200 ? "ok " : "FAIL";
  if (r2.status !== 200) failed++;
  console.log(`[${ok2}] GET /api/admin/stats (admin token)  → ${r2.status} (expected 200)`);

  db.close();
  if (failed > 0) {
    console.error(`\nSMOKE FAILED: ${failed} expectation(s)`);
    process.exit(1);
  }
  console.log("\nSMOKE OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
