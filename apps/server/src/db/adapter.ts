/**
 * D1-shape facade over better-sqlite3. The hosted refuse runs on a different
 * storage backend that uses a similar prepared-statement API; the tool and
 * ingest code is written against that shape, and this adapter lets us reuse
 * it here against SQLite without rewriting.
 *
 * The supported API is:
 *   db.prepare(sql).bind(...args).all<T>()         → { results: T[], meta: ... }
 *   db.prepare(sql).bind(...args).first<T>()       → T | null
 *   db.prepare(sql).bind(...args).run()            → { meta: { changes, ... } }
 *   db.batch([stmt1, stmt2, ...])                  → array of results
 *
 * better-sqlite3 calls are synchronous; we wrap in Promises so callers that
 * `await` don't need to change.
 */

import type Database from "better-sqlite3";

export interface D1Result<T = unknown> {
  results: T[];
  meta: { duration: number; rows_read: number; rows_written: number; changes: number };
}

export interface D1RunResult {
  meta: { duration: number; changes: number; last_row_id: number | bigint };
}

export interface D1Statement {
  bind(...args: unknown[]): D1Statement;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
  raw<T = unknown[]>(): Promise<T[]>;
}

export interface D1LikeDatabase {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<D1Result[]>;
  exec(sql: string): Promise<{ count: number; duration: number }>;
}

class StatementAdapter implements D1Statement {
  /** SQL kept public so batch() can rebuild a prepared stmt inside a transaction. */
  readonly _sql: string;
  /** Bound args, public for the same reason. */
  _args: unknown[] = [];
  private readonly db: Database.Database;

  constructor(db: Database.Database, sql: string) {
    this.db = db;
    this._sql = sql;
  }

  bind(...args: unknown[]): D1Statement {
    const next = new StatementAdapter(this.db, this._sql);
    next._args = args;
    return next;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const started = Date.now();
    const stmt = this.db.prepare(this._sql);
    const rows = stmt.all(...this._args) as T[];
    return {
      results: rows,
      meta: {
        duration: Date.now() - started,
        rows_read: rows.length,
        rows_written: 0,
        changes: 0,
      },
    };
  }

  async first<T = unknown>(): Promise<T | null> {
    const stmt = this.db.prepare(this._sql);
    const row = stmt.get(...this._args) as T | undefined;
    return row ?? null;
  }

  async run(): Promise<D1RunResult> {
    const started = Date.now();
    const stmt = this.db.prepare(this._sql);
    const info = stmt.run(...this._args);
    return {
      meta: {
        duration: Date.now() - started,
        changes: info.changes,
        last_row_id: info.lastInsertRowid,
      },
    };
  }

  async raw<T = unknown[]>(): Promise<T[]> {
    const stmt = this.db.prepare(this._sql);
    stmt.raw(true);
    return stmt.all(...this._args) as T[];
  }
}

export function adapt(db: Database.Database): D1LikeDatabase {
  return {
    prepare(sql: string): D1Statement {
      return new StatementAdapter(db, sql);
    },
    async batch(statements: D1Statement[]): Promise<D1Result[]> {
      // Run all statements inside a single transaction. D1's semantics:
      // "all or nothing per batch". better-sqlite3's transaction helper
      // wraps a sync callback in BEGIN/COMMIT/ROLLBACK.
      const out: D1Result[] = [];
      const txn = db.transaction(() => {
        for (const stmt of statements) {
          const adapter = stmt as StatementAdapter;
          const prepared = db.prepare(adapter._sql);
          const info = prepared.run(...adapter._args);
          out.push({
            results: [],
            meta: {
              duration: 0,
              rows_read: 0,
              rows_written: info.changes,
              changes: info.changes,
            },
          });
        }
      });
      txn();
      return out;
    },
    async exec(sql: string): Promise<{ count: number; duration: number }> {
      const started = Date.now();
      db.exec(sql);
      return { count: 0, duration: Date.now() - started };
    },
  };
}
