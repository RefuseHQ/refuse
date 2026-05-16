import {
  type BatchCheckInput,
  type BatchCheckOutput,
  type CheckPackageInput,
  type CheckPackageOutput,
  type Summary,
} from "@refuse/shared";
import { type CardReader } from "../cards";
import { checkPackage } from "./check-package";
import { buildScanned, trimVulnerable, type EcoResult, type ScannedPackage } from "./_trim";

const FAN_OUT = 32;
const TRUNCATE_AT = 5000;

/** Internal shape: BatchCheckOutput plus a `scanned` array of every package
 * checked (compact, for audit logging). The MCP wrapper strips `scanned` from
 * the agent-facing JSON. */
export type BatchCheckResult = BatchCheckOutput & { scanned: ScannedPackage[] };

/**
 * Implementation of `batch_check`. Runs `check_package` for many inputs in
 * parallel with a fan-out cap (spec §10.9). Deduplicates identical
 * `(ecosystem, name, version)` triples within a request — npm lockfiles
 * commonly repeat the same package many times.
 *
 * For requests > 5,000 packages, returns the first 5,000 with `truncated: true`.
 *
 * Output is trimmed: `results` contains only vulnerable packages with
 * deduped advisories and capped references — the agent-facing JSON for a
 * 254-package go.sum dropped from ~130KB to ~10-20KB this way. The full
 * compact list lives in `scanned` for audit logging.
 */
export async function batchCheck(
  cards: CardReader,
  input: BatchCheckInput,
): Promise<BatchCheckResult> {
  const truncated = input.packages.length > TRUNCATE_AT;
  const trimmed = truncated ? input.packages.slice(0, TRUNCATE_AT) : input.packages;

  const cache = new Map<string, Promise<CheckPackageOutput>>();
  const keyOf = (p: CheckPackageInput): string =>
    `${p.ecosystem}${p.name}${p.version}`;

  const promises: Array<Promise<CheckPackageOutput>> = [];
  let inFlight = 0;
  const queue: Array<() => void> = [];

  // Simple semaphore: limit concurrent card reads.
  async function acquire(): Promise<void> {
    if (inFlight < FAN_OUT) {
      inFlight++;
      return;
    }
    await new Promise<void>((resolve) => queue.push(resolve));
    inFlight++;
  }
  function release(): void {
    inFlight--;
    queue.shift()?.();
  }

  // Track each package's input ecosystem alongside the promise so we can
  // attach it back to the result row (CheckPackageOutput doesn't include
  // ecosystem otherwise — important for the dashboard's per-row package
  // breakdown).
  const inputEcos: string[] = [];
  for (const pkg of trimmed) {
    inputEcos.push(pkg.ecosystem);
    const key = keyOf(pkg);
    let p = cache.get(key);
    if (!p) {
      p = (async (): Promise<CheckPackageOutput> => {
        await acquire();
        try {
          return await checkPackage(cards, pkg);
        } finally {
          release();
        }
      })();
      cache.set(key, p);
    }
    promises.push(p);
  }

  const settled = await Promise.all(promises);
  const fullResults: EcoResult[] = settled.map((r, i) => ({
    ...r,
    ecosystem: inputEcos[i]!,
  }));
  const summary = summarize(fullResults);
  const scanned = buildScanned(fullResults);
  const results = trimVulnerable(fullResults);

  return truncated
    ? { results, summary, truncated: true, scanned }
    : { results, summary, scanned };
}

export function summarize(results: CheckPackageOutput[]): Summary {
  const summary: Summary = {
    total: results.length,
    vulnerable: 0,
    by_severity: { critical: 0, high: 0, medium: 0, low: 0 },
  };
  const byLicense = {
    permissive: 0,
    weak_copyleft: 0,
    strong_copyleft: 0,
    source_available_restricted: 0,
    public_domain: 0,
    unknown: 0,
  };
  let licenseSeen = false;
  let maliciousCount = 0;

  for (const r of results) {
    if (r.malicious) maliciousCount++;
    if (r.license) {
      licenseSeen = true;
      byLicense[r.license.category]++;
    }
    if (!r.vulnerable) continue;
    summary.vulnerable++;
    let worst: "critical" | "high" | "medium" | "low" | null = null;
    for (const v of r.vulnerabilities) {
      if (v.severity_label === "unknown") continue;
      if (!worst || severityRank(v.severity_label) > severityRank(worst)) {
        worst = v.severity_label;
      }
    }
    if (worst) summary.by_severity[worst]++;
  }

  if (maliciousCount > 0) summary.malicious = maliciousCount;
  if (licenseSeen) summary.by_license = byLicense;
  return summary;
}

function severityRank(s: "critical" | "high" | "medium" | "low"): number {
  return s === "critical" ? 4 : s === "high" ? 3 : s === "medium" ? 2 : 1;
}
