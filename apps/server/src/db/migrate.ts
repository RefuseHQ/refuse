/**
 * Migration runner — applies SQL files from src/migrations/ in numeric order.
 * Tracks applied migrations in a `_migrations` table so re-running is safe.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

// Resolve the migrations directory at runtime. tsup bundles everything to
// dist/index.js so import.meta.url points at dist/. The actual location
// depends on whether we're running:
//   - dev (tsx): src/db/migrate.ts → ../migrations
//   - prod bundle: dist/index.js → ./migrations (Dockerfile copies)
// Try a couple of candidates so both work.
function resolveMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "migrations"),
    join(here, "..", "migrations"),
    join(here, "..", "..", "migrations"),
    join(here, "..", "src", "migrations"),
  ];
  for (const c of candidates) {
    try {
      readdirSync(c);
      return c;
    } catch {
      // try next
    }
  }
  return join(here, "migrations"); // fallback (will fail at readdir time, logged)
}

const MIGRATIONS_DIR = resolveMigrationsDir();

interface AppliedRow {
  name: string;
}

export function runMigrations(db: Database.Database, dir = MIGRATIONS_DIR): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const applied = new Set<string>();
  for (const row of db.prepare(`SELECT name FROM _migrations`).all() as AppliedRow[]) {
    applied.add(row.name);
  }

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  } catch (e) {
    console.warn(`refuse: migrations dir not found at ${dir} — skipping (${(e as Error).message})`);
    return;
  }

  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), "utf8");
    const txn = db.transaction(() => {
      db.exec(sql);
      db.prepare(`INSERT INTO _migrations (name) VALUES (?)`).run(f);
    });
    txn();
    console.log(`refuse: applied migration ${f}`);
  }
}
