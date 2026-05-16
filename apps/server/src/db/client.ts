/**
 * SQLite client. Uses better-sqlite3 (synchronous, native — built once during
 * `pnpm install`, copied into the runtime image at build time). WAL mode so
 * concurrent reads don't block on the cron writer.
 */

import Database from "better-sqlite3";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

export type SqliteDb = Database.Database;

export function openDb(dbPath: string): SqliteDb {
  // Make sure the parent dir exists — common Docker first-boot case where
  // /data is a fresh empty volume.
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
  } catch {
    // mkdirSync is idempotent with recursive: true; ignore EEXIST.
  }

  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
  db.pragma("temp_store = MEMORY");

  return db;
}
