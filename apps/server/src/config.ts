/**
 * Server config — env-driven, validated at boot. Unknown REFUSE_* env vars
 * produce a warning so typos are visible. Defaults are picked so `docker run`
 * with no flags Just Works.
 */

import { z } from "zod";

const KNOWN_PREFIXES = ["REFUSE_"];
const RECOGNISED_KEYS = new Set([
  "REFUSE_PORT",
  "REFUSE_DB_PATH",
  "REFUSE_REQUIRE_KEY",
  "REFUSE_ADMIN_TOKEN",
  "REFUSE_OSV_FREQUENCY",
  "REFUSE_DEPS_DEV_FREQUENCY",
  "REFUSE_ENRICHMENT_CRON",
  "REFUSE_BOOTSTRAP_ON_EMPTY",
  "REFUSE_OSV_CONCURRENCY",
  "REFUSE_LOG_LEVEL",
  "REFUSE_GITHUB_TOKEN",
  "REFUSE_DISABLE_INGEST",
  "REFUSE_CARD_CACHE_SIZE",
  "REFUSE_CARD_CACHE_TTL_SECONDS",
  "REFUSE_CORS_ORIGIN",
]);

const boolish = z
  .string()
  .transform((s) => s.toLowerCase())
  .pipe(z.enum(["true", "false", "1", "0", "yes", "no"]))
  .transform((s) => s === "true" || s === "1" || s === "yes");

const positiveInt = z.coerce.number().int().positive();
const nonNegativeInt = z.coerce.number().int().nonnegative();

const schema = z.object({
  REFUSE_PORT: positiveInt.default(8080),
  REFUSE_DB_PATH: z.string().default("/data/refuse.db"),
  REFUSE_REQUIRE_KEY: boolish.default("false"),
  REFUSE_ADMIN_TOKEN: z.string().optional(),
  REFUSE_OSV_FREQUENCY: positiveInt.default(5),
  REFUSE_DEPS_DEV_FREQUENCY: positiveInt.default(15),
  REFUSE_ENRICHMENT_CRON: z.string().default("0 5 * * *"),
  REFUSE_BOOTSTRAP_ON_EMPTY: boolish.default("true"),
  REFUSE_OSV_CONCURRENCY: positiveInt.default(4),
  REFUSE_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  REFUSE_GITHUB_TOKEN: z.string().optional(),
  REFUSE_DISABLE_INGEST: boolish.default("false"),
  REFUSE_CARD_CACHE_SIZE: positiveInt.default(5000),
  REFUSE_CARD_CACHE_TTL_SECONDS: nonNegativeInt.default(600),
  REFUSE_CORS_ORIGIN: z.string().default("*"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Warn about unknown REFUSE_* env vars so typos surface immediately.
  for (const k of Object.keys(env)) {
    if (KNOWN_PREFIXES.some((p) => k.startsWith(p)) && !RECOGNISED_KEYS.has(k)) {
      console.warn(`refuse: unknown env var ignored: ${k}`);
    }
  }

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    console.error("refuse: invalid config");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(2);
  }
  return parsed.data;
}
