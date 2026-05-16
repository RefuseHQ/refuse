/**
 * Cards reader. The vendored tool handlers all ask "give me the VulnCard for
 * this (ecosystem, package)" and don't care how it's stored. In hosted, cards
 * are pre-built and stashed in a KV store; in OSS we build them on the fly
 * from SQLite (see implementation below).
 *
 * The reader is wrapped by an LRU cache so hot packages skip the SQL round
 * trip on subsequent reads. On every ingest tick we evict the touched
 * (ecosystem, name) keys so updates show up immediately.
 *
 * v0: stub returns null for everything. Real implementation lands in the
 * "implement cards reader" task.
 */

import type Database from "better-sqlite3";
import { LRUCache } from "lru-cache";
import type { VulnCard } from "@refuse/shared";

export interface CardReader {
  readCard(ecosystem: string, name: string): Promise<VulnCard | null>;
  invalidate(ecosystem: string, name: string): void;
}

export interface CardReaderConfig {
  maxEntries: number;
  ttlSeconds: number;
}

/**
 * Sentinel for "we looked, there's no card". Lets us cache the negative result
 * without needing a nullable value type (lru-cache v11 rejects nulls).
 */
const ABSENT = Symbol("absent");
type CachedValue = VulnCard | typeof ABSENT;

export function makeCardReader(
  _db: Database.Database,
  config: CardReaderConfig,
): CardReader {
  const cache = new LRUCache<string, CachedValue>({
    max: config.maxEntries,
    ttl: config.ttlSeconds * 1000,
  });

  const key = (ecosystem: string, name: string): string => `${ecosystem}:${name}`;

  return {
    async readCard(ecosystem, name) {
      const k = key(ecosystem, name);
      const cached = cache.get(k);
      if (cached !== undefined) {
        return cached === ABSENT ? null : cached;
      }
      // TODO (task: implement cards reader): build the card from
      //   vulnerabilities + affected_packages + package_versions + kev + epss
      //   joins and populate the cache. For now: always miss → null.
      cache.set(k, ABSENT);
      return null;
    },
    invalidate(ecosystem, name) {
      cache.delete(key(ecosystem, name));
    },
  };
}
