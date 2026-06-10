/**
 * Top-level Hono router. Mounts /healthz, /api/*, /mcp, /ui/*. Auth middleware
 * is applied per-mount so the routes that need a key get one and /healthz
 * stays open.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import type Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import type { Config } from "../config";
import type { CardReader } from "../cards";
import type { Scheduler } from "../ingest/scheduler";
import { makeKeyAuth, makeAdminAuth } from "./auth";
import { buildRestRouter } from "./rest";
import { buildAdminRouter, buildKeysRouter } from "./admin";

export interface AppDeps {
  db: Database.Database;
  config: Config;
  cards: CardReader;
  scheduler: Scheduler;
}

export function buildApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use("/api/v1/*", cors({ origin: deps.config.REFUSE_CORS_ORIGIN, allowMethods: ["POST", "OPTIONS"], allowHeaders: ["Authorization", "Content-Type"] }));

  // Liveness — always open. Returns 200 as long as the DB handle works,
  // independent of whether ingestion has finished its initial pass.
  app.get("/healthz", (c) => {
    try {
      const row = deps.db.prepare(`SELECT 1 as ok`).get() as { ok: number } | undefined;
      if (row?.ok !== 1) return c.json({ status: "down", detail: "db ping failed" }, 503);
    } catch (e) {
      return c.json({ status: "down", detail: (e as Error).message }, 503);
    }
    return c.json({ status: "ok" });
  });

  // Readiness — returns 200 only after every required ingestion source has
  // completed at least one successful pass. Returns 503 with the missing
  // sources listed during the initial bootstrap. Suitable for Docker
  // `--health-cmd`, k8s readiness probes, and "is the seed done?" UX.
  app.get("/readyz", (c) => {
    const snap = deps.scheduler.getReadiness();
    return c.json(snap, snap.ready ? 200 : 503);
  });

  // Authed surface: /mcp + /api/v1/check/*. Open by default; bearer required
  // when REFUSE_REQUIRE_KEY=true.
  const keyAuth = makeKeyAuth(deps.config, deps.db);
  app.use("/api/v1/*", keyAuth);
  app.use("/mcp", keyAuth);

  app.route("/api/v1", buildRestRouter({ cards: deps.cards }));

  // /mcp will be wired up in the "vendor MCP tool handlers" task. Placeholder
  // returns 501 so callers see a meaningful error instead of a route miss.
  app.post("/mcp", () =>
    new Response(
      JSON.stringify({
        error: "Not implemented yet",
        detail: "MCP Streamable HTTP transport will be wired up in a follow-up.",
      }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    ),
  );

  // Admin-gated routes (key CRUD, manual ingest triggers, stats).
  const adminAuth = makeAdminAuth(deps.config);
  app.use("/api/admin/*", adminAuth);
  app.use("/api/keys/*", adminAuth);

  app.route(
    "/api/admin",
    buildAdminRouter({
      rawDb: deps.db,
      config: deps.config,
      scheduler: deps.scheduler,
    }),
  );
  app.route("/api/keys", buildKeysRouter(deps.db));

  // Embedded UI — vanilla HTML/JS served from src/ui/static/. Always open;
  // the UI itself prompts for the admin token where needed.
  const uiRoot = resolveUiRoot();
  if (uiRoot) {
    app.use(
      "/ui/*",
      serveStatic({ root: uiRoot, rewriteRequestPath: (p) => p.replace(/^\/ui/, "") }),
    );
    app.get("/ui", (c) => c.redirect("/ui/"));
  }

  // Root: friendly message pointing at the surfaces.
  app.get("/", (c) =>
    c.text(
      "refuse server is running. See /healthz, /api/v1/check/package (POST), /mcp (POST), /ui/",
    ),
  );

  app.notFound((c) => c.json({ error: "Not found" }, 404));
  app.onError((err, c) => {
    console.error("refuse:", err);
    return c.json({ error: err.message }, 500);
  });

  return app;
}

/**
 * Resolve the on-disk path of the UI static assets. In dev (tsx) we live in
 * src/http/router.ts so the assets are at ../ui/static. In production
 * (compiled, run as node dist/index.js) the entrypoint script and the
 * Dockerfile copy the static dir to a sibling location — we probe a couple
 * of candidates.
 */
function resolveUiRoot(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    // bundled (dist/index.js → dist/ui/static, what the Dockerfile copies)
    join(here, "ui", "static"),
    // dev (src/http/router.ts → src/ui/static)
    join(here, "..", "ui", "static"),
    join(here, "..", "..", "ui", "static"),
    join(here, "..", "..", "..", "ui", "static"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}
