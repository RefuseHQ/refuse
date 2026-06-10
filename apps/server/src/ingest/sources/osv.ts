import { unzipSync, Unzip, UnzipInflate } from "fflate";
import { OsvRecord, type OsvRecord as OsvRecordT } from "@refuse/shared";

/**
 * OSV.dev data sources:
 * - Single record:        https://api.osv.dev/v1/vulns/{id}
 * - Per-ecosystem zip:    https://osv-vulnerabilities.storage.googleapis.com/{ecosystem}/all.zip
 * - Bulk (everything):    https://osv-vulnerabilities.storage.googleapis.com/all.zip
 *
 * The bulk archive is ~200 MB compressed; pull it from a local backfill
 * script, not from a Worker. Per-ecosystem zips are an order of magnitude
 * smaller and acceptable to fetch from the cron worker.
 */

const OSV_API_BASE = "https://api.osv.dev/v1";
const OSV_GCS_BASE = "https://osv-vulnerabilities.storage.googleapis.com";

export interface OsvFetcher {
  /** Fetch a single OSV record by id (CVE, GHSA, OSV id, etc.). */
  getRecord(id: string): Promise<OsvRecordT | null>;
  /** Fetch a per-ecosystem zip archive as bytes. */
  fetchEcosystemArchive(ecosystem: string): Promise<Uint8Array>;
  /**
   * Open a streaming response for a per-ecosystem zip — pair with
   * `streamZipRecords` so we never hold the full archive in memory.
   */
  /** Returns null when GCS responds 404 — caller should skip + advance. */
  openEcosystemArchive(ecosystem: string): Promise<ReadableStream<Uint8Array> | null>;
  /** Fetch the full bulk archive — only call from the local backfill script. */
  fetchAllArchive(): Promise<Uint8Array>;
  /**
   * Streaming version of the bulk archive — pair with `streamZipRecords` so
   * we don't materialize the ~600 MB uncompressed payload in memory. Safe to
   * use from any host that isn't memory-constrained (i.e. anything other
   * than the Workers runtime).
   */
  openAllArchive(): Promise<ReadableStream<Uint8Array>>;
}

export interface OsvFetcherDeps {
  /** Override `fetch` for tests. Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
}

export function createOsvFetcher(deps: OsvFetcherDeps = {}): OsvFetcher {
  const f = deps.fetch ?? globalThis.fetch;

  return {
    async getRecord(id) {
      const res = await f(`${OSV_API_BASE}/vulns/${encodeURIComponent(id)}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`OSV API ${res.status}: ${await res.text()}`);
      }
      const json = await res.json();
      const parsed = OsvRecord.safeParse(json);
      if (!parsed.success) {
        throw new Error(`OSV record ${id} failed schema validation: ${parsed.error.message}`);
      }
      return parsed.data;
    },

    async fetchEcosystemArchive(ecosystem) {
      // GCS keys don't URL-encode `:`/spaces in ecosystem names — but we do for safety.
      const path = encodeURIComponent(ecosystem).replace(/%3A/g, ":");
      const res = await f(`${OSV_GCS_BASE}/${path}/all.zip`);
      if (!res.ok) {
        throw new Error(`OSV GCS fetch failed for ${ecosystem}: ${res.status}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async openEcosystemArchive(ecosystem) {
      const path = encodeURIComponent(ecosystem).replace(/%3A/g, ":");
      const res = await f(`${OSV_GCS_BASE}/${path}/all.zip`);
      // 404 = OSV doesn't publish this ecosystem's archive (e.g. Ubuntu:20.04
      // after EOL). Surface as null so the caller can skip + advance the
      // rotation rather than getting stuck retrying the same dead URL forever.
      if (res.status === 404) return null;
      if (!res.ok || !res.body) {
        throw new Error(
          `OSV GCS fetch failed for ${ecosystem}: ${res.status}${res.body ? "" : " (no body)"}`,
        );
      }
      return res.body;
    },

    async fetchAllArchive() {
      const res = await f(`${OSV_GCS_BASE}/all.zip`);
      if (!res.ok) {
        throw new Error(`OSV GCS fetch failed for all.zip: ${res.status}`);
      }
      return new Uint8Array(await res.arrayBuffer());
    },

    async openAllArchive() {
      const res = await f(`${OSV_GCS_BASE}/all.zip`);
      if (!res.ok || !res.body) {
        throw new Error(
          `OSV GCS fetch failed for all.zip: ${res.status}${res.body ? "" : " (no body)"}`,
        );
      }
      return res.body;
    }};
}

/**
 * Iterate over every OSV record in an in-memory zip archive. Yields
 * `{ name, record }` pairs; entries that fail schema validation are skipped
 * with a `warnings` array on the result.
 */
export interface IterateResult {
  records: Array<{ name: string; record: OsvRecordT }>;
  skipped: Array<{ name: string; reason: string }>;
}

/**
 * Stream-decompress a zip and invoke `onRecord` for each valid OSV JSON entry.
 * Memory-bounded: we never hold the full archive (npm's `all.zip` is ~200 MB
 * compressed, several × that decompressed — too big for `unzipSync` inside a
 * Worker). Each entry is buffered individually then handed to the callback.
 *
 * `onRecord` may be async; the stream waits for it before consuming more
 * compressed bytes from the network.
 */
export interface StreamCallbacks {
  onRecord: (rec: { name: string; record: OsvRecordT }) => void | Promise<void>;
  onSkipped?: (skip: { name: string; reason: string }) => void;
  /** Optional early-stop predicate; when it returns true the stream halts. */
  shouldStop?: () => boolean;
}

export async function streamZipRecords(
  body: ReadableStream<Uint8Array>,
  cb: StreamCallbacks,
): Promise<{ stopped: boolean }> {
  const decoder = new TextDecoder("utf-8");
  const pending: Array<Promise<void>> = [];
  let stopped = false;
  let unzipFailure: Error | null = null;

  const unzip = new Unzip((file) => {
    if (stopped || !file.name.endsWith(".json")) {
      // Drop the entry; we still need to call start() to advance the stream.
      file.ondata = () => {};
      file.start();
      return;
    }
    const chunks: Uint8Array[] = [];
    file.ondata = (err, data, final) => {
      if (err) {
        unzipFailure = err as Error;
        return;
      }
      if (data && data.length > 0) chunks.push(data);
      if (!final) return;

      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) {
        merged.set(c, o);
        o += c.length;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(decoder.decode(merged));
      } catch (e) {
        cb.onSkipped?.({ name: file.name, reason: `invalid JSON: ${(e as Error).message}` });
        return;
      }
      const result = OsvRecord.safeParse(parsed);
      if (!result.success) {
        cb.onSkipped?.({ name: file.name, reason: `schema error: ${result.error.message}` });
        return;
      }
      const ret = cb.onRecord({ name: file.name, record: result.data });
      if (ret instanceof Promise) pending.push(ret);
    };
    file.start();
  });
  unzip.register(UnzipInflate);

  const reader = body.getReader();
  try {
    for (;;) {
      if (cb.shouldStop?.()) {
        stopped = true;
        break;
      }
      const { done, value } = await reader.read();
      if (done) {
        unzip.push(new Uint8Array(0), true);
        break;
      }
      if (value) unzip.push(value, false);
      // Backpressure: drain in-flight callbacks before pulling more.
      if (pending.length > 0) {
        await Promise.all(pending.splice(0, pending.length));
      }
      if (unzipFailure) throw unzipFailure;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // releaseLock fails when the reader is mid-read; ignore.
    }
  }

  if (pending.length > 0) await Promise.all(pending);
  if (unzipFailure) throw unzipFailure;
  return { stopped };
}

export function iterateZipRecords(zipBytes: Uint8Array): IterateResult {
  const entries = unzipSync(zipBytes);
  const records: IterateResult["records"] = [];
  const skipped: IterateResult["skipped"] = [];
  const decoder = new TextDecoder("utf-8");

  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.endsWith(".json")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoder.decode(bytes));
    } catch (e) {
      skipped.push({ name, reason: `invalid JSON: ${(e as Error).message}` });
      continue;
    }
    const result = OsvRecord.safeParse(parsed);
    if (!result.success) {
      skipped.push({ name, reason: `schema error: ${result.error.message}` });
      continue;
    }
    records.push({ name, record: result.data });
  }

  return { records, skipped };
}
