/**
 * Cards reader. The vendored tool handlers all ask "give me the VulnCard for
 * this (ecosystem, package)" and don't care how it's stored. Cards are built
 * on the fly from SQLite — same shape, just no pre-published store. An LRU
 * cache in front absorbs hot-path reads; ingest invalidates affected
 * (ecosystem, name) keys when it writes new rows.
 *
 * The underlying SQL is shared with the ingest layer's publishCards code path
 * via `buildCardForPackage`, so a card built here is identical to one that
 * would have been pre-published — there is no "stale view" risk.
 */

import type Database from "better-sqlite3";
import { LRUCache } from "lru-cache";
import type { VulnCard } from "@refuse/shared";
import { adapt, type D1LikeDatabase } from "../db/adapter";
import { buildCardForPackage } from "../ingest/publish-cards";

export interface CardReader {
  readCard(ecosystem: string, name: string): Promise<VulnCard | null>;
  invalidate(ecosystem: string, name: string): void;
}

export interface CardReaderConfig {
  maxEntries: number;
  ttlSeconds: number;
}

/** Cache "we looked, there's no card" without a nullable value type. */
const ABSENT = Symbol("absent");
type CachedValue = VulnCard | typeof ABSENT;

export function makeCardReader(
  rawDb: Database.Database,
  config: CardReaderConfig,
): CardReader {
  const cache = new LRUCache<string, CachedValue>({
    max: config.maxEntries,
    ttl: config.ttlSeconds * 1000,
  });
  // Single facade instance reused across calls — adapter has no internal state.
  const db: D1LikeDatabase = adapt(rawDb);

  const key = (ecosystem: string, name: string): string => `${ecosystem}:${name}`;

  return {
    async readCard(ecosystem, name) {
      const k = key(ecosystem, name);
      const cached = cache.get(k);
      if (cached !== undefined) {
        return cached === ABSENT ? null : cached;
      }
      let card: VulnCard | null;
      try {
        ({ card } = await buildCardForPackage(db, ecosystem, name));
      } catch (e) {
        // Card build failure is non-fatal — log and treat as "absent" for
        // this request. The tool layer's check_package returns
        // vulnerable=false / freshness=stale on a null card, which is the
        // correct fail-open behaviour.
        console.warn(
          `refuse: card build failed for ${ecosystem}:${name}: ${(e as Error).message}`,
        );
        cache.set(k, ABSENT);
        return null;
      }
      cache.set(k, card ?? ABSENT);
      return card;
    },
    invalidate(ecosystem, name) {
      cache.delete(key(ecosystem, name));
    },
  };
}
