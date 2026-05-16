/**
 * Admin endpoints — gated by REFUSE_ADMIN_TOKEN (the makeAdminAuth middleware
 * in router.ts). Powers the embedded UI's dashboard / sources / config / keys
 * panels and the manual "refresh now" trigger.
 *
 * All routes return JSON. None of them require knowing about Cloudflare; they
 * read directly from the SQLite handle.
 */

import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { Config } from "../config";
import type { Scheduler } from "../ingest/scheduler";
import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX = "rfs_";

function generateRawKey(): string {
  // ~24 base62 chars after the prefix; cryptographically random.
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(18);
  let out = KEY_PREFIX;
  for (const b of bytes) out += ALPHA[b % ALPHA.length];
  return out;
}

function prefixOf(rawKey: string): string {
  return rawKey.slice(0, KEY_PREFIX.length + 8);
}

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function ulid(): string {
  const ts = Date.now().toString(36).padStart(8, "0");
  const r = randomBytes(8).toString("hex");
  return `${ts}${r}`;
}

const SENSITIVE_ENV = new Set([
  "REFUSE_ADMIN_TOKEN",
  "REFUSE_GITHUB_TOKEN",
]);

function maskValue(name: string, value: unknown): string {
  if (!SENSITIVE_ENV.has(name)) return String(value);
  const s = String(value);
  if (!s) return "(unset)";
  return s.length > 8 ? `${s.slice(0, 4)}…${s.slice(-2)}` : "(set)";
}

export interface AdminDeps {
  rawDb: Database.Database;
  config: Config;
  scheduler: Scheduler;
}

export function buildAdminRouter(deps: AdminDeps): Hono {
  const app = new Hono();
  const { rawDb, config, scheduler } = deps;

  app.get("/stats", (c) => {
    const tables = ["vulnerabilities", "affected_packages", "package_versions", "kev", "epss", "api_keys"];
    const rows: Record<string, number> = {};
    for (const t of tables) {
      try {
        const r = rawDb.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number } | undefined;
        rows[t] = r?.n ?? 0;
      } catch {
        rows[t] = -1;
      }
    }
    return c.json({ rows });
  });

  app.get("/sources", (c) => {
    try {
      const rows = rawDb
        .prepare(
          `SELECT source, last_modified, last_run_at, last_status, last_error,
                  records_processed, last_ok_at
           FROM ingestion_state ORDER BY source ASC`,
        )
        .all();
      return c.json({ sources: rows });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  app.post("/ingest/:source", async (c) => {
    const source = c.req.param("source");
    if (source !== "osv" && source !== "deps-dev" && source !== "enrichment") {
      return c.json({ error: "source must be one of: osv, deps-dev, enrichment" }, 400);
    }
    // Fire-and-forget — long runs shouldn't block the HTTP response.
    const started = Date.now();
    scheduler.trigger(source).catch(() => {});
    return c.json({ triggered: source, started_at: new Date(started).toISOString() });
  });

  app.get("/config", (c) => {
    const entries = Object.entries(config).map(([k, v]) => ({
      name: k,
      value: maskValue(k, v),
      sensitive: SENSITIVE_ENV.has(k),
    }));
    return c.json({ config: entries });
  });

  return app;
}

/** Key CRUD — mounted at /api/keys/*. Same admin-token auth as /api/admin/*. */
export function buildKeysRouter(rawDb: Database.Database): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const rows = rawDb
      .prepare(
        `SELECT id, prefix, name, created_at, last_used_at, revoked_at
         FROM api_keys ORDER BY created_at DESC`,
      )
      .all();
    return c.json({ keys: rows });
  });

  app.post("/", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string };
    const raw = generateRawKey();
    const id = ulid();
    rawDb
      .prepare(
        `INSERT INTO api_keys (id, prefix, hash, name) VALUES (?, ?, ?, ?)`,
      )
      .run(id, prefixOf(raw), hashKey(raw), body.name ?? null);
    return c.json({ id, prefix: prefixOf(raw), key: raw }, 201);
  });

  app.delete("/:id", (c) => {
    const id = c.req.param("id");
    const info = rawDb
      .prepare(
        `UPDATE api_keys SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(id);
    if (info.changes === 0) return c.json({ error: "Key not found or already revoked" }, 404);
    return c.json({ revoked: true });
  });

  return app;
}
