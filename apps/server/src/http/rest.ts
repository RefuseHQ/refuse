/**
 * REST endpoints exposing the package-check tools as plain HTTP. Each route
 * mirrors an MCP tool: same input shape (as JSON body), same output shape.
 *
 * Errors:
 *   - 400 on malformed body or missing required fields
 *   - 500 on internal failure (tools are written to "fail open" — they should
 *         only throw on programmer error)
 */

import { Hono } from "hono";
import type { CardReader } from "../cards";
import { checkPackage } from "../tools/check-package";
import { batchCheck } from "../tools/batch-check";
import { checkLockfile } from "../tools/check-lockfile";
import { checkDockerfile } from "../tools/check-dockerfile";
import { checkWorkflow } from "../tools/check-workflow";
import { suggestSafeVersion } from "../tools/suggest-safe-version";

export interface RestDeps {
  cards: CardReader;
}

function stripScanned(result: unknown): unknown {
  if (!result || typeof result !== "object" || !("scanned" in (result as object))) {
    return result;
  }
  const { scanned: _scanned, ...rest } = result as Record<string, unknown>;
  return rest;
}

function readString(obj: Record<string, unknown>, key: string, maxLen: number): string {
  const v = obj[key];
  if (typeof v !== "string" || !v) throw new BadRequest(`Required: ${key} (string)`);
  if (v.length > maxLen) throw new BadRequest(`${key} exceeds ${maxLen} chars`);
  return v;
}

function readOptString(obj: Record<string, unknown>, key: string, maxLen: number): string | undefined {
  const v = obj[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new BadRequest(`${key} must be a string`);
  if (v.length > maxLen) throw new BadRequest(`${key} exceeds ${maxLen} chars`);
  return v;
}

class BadRequest extends Error {}

export function buildRestRouter(deps: RestDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    console.error("refuse rest:", err);
    return c.json({ error: err.message }, 500);
  });

  app.post("/check/package", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ecosystem = readString(body, "ecosystem", 64);
    const name = readString(body, "name", 256);
    const version = readString(body, "version", 128);
    const result = await checkPackage(deps.cards, { ecosystem, name, version });
    return c.json(stripScanned(result));
  });

  app.post("/check/batch", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const packages = body.packages;
    if (!Array.isArray(packages)) throw new BadRequest("Required: packages (array)");
    const inputs = packages.map((p, i) => {
      if (!p || typeof p !== "object") throw new BadRequest(`packages[${i}] must be an object`);
      const rec = p as Record<string, unknown>;
      if (typeof rec.ecosystem !== "string" || typeof rec.name !== "string" || typeof rec.version !== "string") {
        throw new BadRequest(`packages[${i}] requires ecosystem, name, version (strings)`);
      }
      return { ecosystem: rec.ecosystem, name: rec.name, version: rec.version };
    });
    const result = await batchCheck(deps.cards, { packages: inputs });
    return c.json(stripScanned(result));
  });

  app.post("/check/lockfile", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const filename = readString(body, "filename", 256);
    const content = readString(body, "content", 5_000_000);
    const result = await checkLockfile(deps.cards, { filename, content });
    return c.json(stripScanned(result));
  });

  app.post("/check/dockerfile", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const content = readString(body, "content", 1_000_000);
    const detected_distro = readOptString(body, "detected_distro", 64);
    const result = await checkDockerfile(deps.cards, {
      content,
      ...(detected_distro !== undefined ? { detected_distro } : {}),
    });
    return c.json(stripScanned(result));
  });

  app.post("/check/workflow", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const content = readString(body, "content", 1_000_000);
    const result = await checkWorkflow(deps.cards, { content });
    return c.json(stripScanned(result));
  });

  app.post("/suggest-safe-version", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const ecosystem = readString(body, "ecosystem", 64);
    const name = readString(body, "name", 256);
    const current_version = readOptString(body, "current_version", 128);
    const result = await suggestSafeVersion(deps.cards, {
      ecosystem,
      name,
      ...(current_version !== undefined ? { current_version } : {}),
    });
    return c.json(stripScanned(result));
  });

  return app;
}
