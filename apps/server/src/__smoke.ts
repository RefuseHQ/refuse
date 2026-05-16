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
  // Smoke test scheduler stub — no real cron.
  const scheduler = { start: () => {}, stop: () => {}, trigger: async () => {} };

  const app = buildApp({ db, config, cards, scheduler });

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
  const locked = buildApp({ db, config: lockedConfig, cards, scheduler });
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

  // Seed a fake advisory + affected package so the cards reader has
  // something real to build. Then verify check_package picks it up.
  db.prepare(
    `INSERT OR REPLACE INTO vulnerabilities
       (refuse_id, primary_id, aliases, summary, details, severity_score, severity_label, severity_vector, references_json, published_at, modified_at, withdrawn_at, raw_osv, is_malicious)
     VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, NULL, ?, 0)`,
  ).run(
    "rfs-smoke-0001",
    "CVE-2099-99999",
    JSON.stringify(["CVE-2099-99999"]),
    "Smoke-test advisory",
    9.8,
    "critical",
    JSON.stringify(["https://example.test/advisory"]),
    "2099-01-01T00:00:00Z",
    "2099-01-01T00:00:00Z",
    "{}",
  );
  db.prepare(
    `INSERT OR REPLACE INTO affected_packages
       (refuse_id, ecosystem, package_name, ranges_json, fix_versions)
     VALUES (?, 'npm', 'smoke-pkg', ?, ?)`,
  ).run(
    "rfs-smoke-0001",
    JSON.stringify([{ introduced: "0.0.0", fixed: "1.0.0" }]),
    JSON.stringify(["1.0.0"]),
  );
  db.prepare(
    `INSERT OR REPLACE INTO package_versions
       (ecosystem, package_name, version, is_prerelease, is_yanked, released_at, license_spdx, license_category)
     VALUES ('npm', 'smoke-pkg', '0.5.0', 0, 0, '2099-01-01', 'MIT', 'permissive')`,
  ).run();

  // Invalidate so the (potentially cached null) gets refreshed.
  cards.invalidate("npm", "smoke-pkg");

  const r3 = await app.fetch(
    new Request("http://localhost/api/v1/check/package", {
      method: "POST",
      body: JSON.stringify({ ecosystem: "npm", name: "smoke-pkg", version: "0.5.0" }),
      headers: { "Content-Type": "application/json" },
    }),
  );
  const body3 = (await r3.json()) as { vulnerable?: boolean; vulnerabilities?: unknown[] };
  const okVuln = body3.vulnerable === true && (body3.vulnerabilities?.length ?? 0) > 0;
  if (!okVuln) failed++;
  console.log(
    `[${okVuln ? "ok " : "FAIL"}] cards reader: smoke-pkg@0.5.0 → vulnerable=${body3.vulnerable} (expected true)`,
  );

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
