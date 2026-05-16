/**
 * Auth middleware. Two surfaces, both bearer-based:
 *
 *  - API key (`REFUSE_REQUIRE_KEY=true`): looked up in the api_keys table by
 *    sha256(rawKey). Required on /mcp and /api/v1/check/*.
 *  - Admin token (`REFUSE_ADMIN_TOKEN=<token>`): static string. Required on
 *    /api/admin/* and /api/keys/*. If unset, admin endpoints respond 503.
 *
 * When `REFUSE_REQUIRE_KEY=false` (default), the API surface is open and the
 * key middleware is a no-op.
 */

import type { Context, MiddlewareHandler } from "hono";
import type { Config } from "../config";
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

const KEY_PREFIX = "rfs_";

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

function readBearer(c: Context): string | null {
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

interface KeyRow {
  id: string;
  prefix: string;
}

export interface AuthContext {
  /** API key id if authenticated; null when REFUSE_REQUIRE_KEY=false. */
  api_key_id: string | null;
}

export function makeKeyAuth(config: Config, db: Database.Database): MiddlewareHandler {
  if (!config.REFUSE_REQUIRE_KEY) {
    return async (c, next) => {
      c.set("auth", { api_key_id: null } satisfies AuthContext);
      await next();
    };
  }

  const lookup = db.prepare(
    `SELECT id, prefix FROM api_keys WHERE hash = ? AND revoked_at IS NULL`,
  );
  const touch = db.prepare(
    `UPDATE api_keys SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`,
  );

  return async (c, next) => {
    const rawKey = readBearer(c);
    if (!rawKey || !rawKey.startsWith(KEY_PREFIX)) {
      return c.json(
        {
          error: "Authentication required",
          detail: "Send `Authorization: Bearer rfs_...`. Create a key via the admin UI at /ui/keys.",
        },
        401,
        {
          "WWW-Authenticate":
            'Bearer realm="refuse", error="invalid_token", error_description="API key required"',
        },
      );
    }

    const row = lookup.get(hashKey(rawKey)) as KeyRow | undefined;
    if (!row) return c.json({ error: "Invalid or revoked API key" }, 401);

    try {
      touch.run(row.id);
    } catch {
      // last_used_at is best-effort; never block the request on it.
    }
    c.set("auth", { api_key_id: row.id } satisfies AuthContext);
    await next();
  };
}

export function makeAdminAuth(config: Config): MiddlewareHandler {
  return async (c, next) => {
    if (!config.REFUSE_ADMIN_TOKEN) {
      return c.json(
        {
          error: "Admin endpoints disabled",
          detail: "Set REFUSE_ADMIN_TOKEN to enable admin endpoints.",
        },
        503,
      );
    }
    const supplied = readBearer(c);
    if (supplied !== config.REFUSE_ADMIN_TOKEN) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  };
}
