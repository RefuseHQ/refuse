/**
 * Top-level Hono router. Mounts /healthz, /api/*, /mcp, /ui/*. Auth middleware
 * is applied per-mount so the routes that need a key get one and /healthz
 * stays open.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import type Database from "better-sqlite3";
import type { Config } from "../config";
import type { CardReader } from "../cards";
import { makeKeyAuth, makeAdminAuth } from "./auth";
import { buildRestRouter } from "./rest";

export interface AppDeps {
  db: Database.Database;
  config: Config;
  cards: CardReader;
}

export function buildApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use("/api/v1/*", cors({ origin: deps.config.REFUSE_CORS_ORIGIN, allowMethods: ["POST", "OPTIONS"], allowHeaders: ["Authorization", "Content-Type"] }));

  // Liveness — always open.
  app.get("/healthz", (c) => {
    try {
      const row = deps.db.prepare(`SELECT 1 as ok`).get() as { ok: number } | undefined;
      if (row?.ok !== 1) return c.json({ status: "down", detail: "db ping failed" }, 503);
    } catch (e) {
      return c.json({ status: "down", detail: (e as Error).message }, 503);
    }
    return c.json({ status: "ok" });
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

  // Admin-gated routes (key CRUD, manual ingest triggers).
  const adminAuth = makeAdminAuth(deps.config);
  app.use("/api/admin/*", adminAuth);
  app.use("/api/keys/*", adminAuth);

  app.get("/api/admin/stats", (c) => {
    const row = deps.db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`).get() as { n: number } | undefined;
    return c.json({
      tables: row?.n ?? 0,
      detail: "Full stats endpoint will be wired up in a follow-up.",
    });
  });

  // Embedded UI: serves vanilla HTML/JS from src/ui/static/. Will be added
  // in the UI task; for now the route is a placeholder.
  app.get("/ui/*", (c) =>
    c.text("UI assets will be served here once added (see roadmap).", 501),
  );
  app.get("/ui", (c) => c.redirect("/ui/"));

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
