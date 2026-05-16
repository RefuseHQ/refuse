import type { CheckPackageOutput, VulnerabilityRef } from "@refuse/shared";

const MAX_REFERENCES = 3;

export interface ScannedPackage {
  ecosystem: string;
  name: string;
  version: string;
  vulnerable: boolean;
}

export type EcoResult = CheckPackageOutput & { ecosystem: string };

/**
 * Compact (eco, name, version, vulnerable) tuples for audit logging. Includes
 * every package we checked so the dashboard can show "what was scanned"
 * even for the clean ones. Stripped from the agent-facing response.
 */
export function buildScanned(results: EcoResult[]): ScannedPackage[] {
  return results.map((r) => ({
    ecosystem: r.ecosystem,
    name: r.package,
    version: r.version,
    vulnerable: r.vulnerable,
  }));
}

/**
 * Drop non-vulnerable rows, dedupe per-package vulnerabilities (the OSV +
 * GHSA + NVD merge produces multiple records for the same CVE with
 * different severity scores), and cap references — agents don't need
 * 6 URLs per advisory and references blow up the response size.
 */
export function trimVulnerable(results: EcoResult[]): EcoResult[] {
  return results
    .filter((r) => r.vulnerable)
    .map((r) => ({
      ...r,
      vulnerabilities: dedupeVulns(r.vulnerabilities).map((v) => ({
        ...v,
        references: v.references.slice(0, MAX_REFERENCES),
      })),
    }));
}

function dedupeVulns(vulns: VulnerabilityRef[]): VulnerabilityRef[] {
  const map = new Map<string, VulnerabilityRef>();
  for (const v of vulns) {
    const key = v.cve ?? v.ghsa ?? v.refuse_id;
    const prev = map.get(key);
    // Prefer the entry with a real severity score over the unknown/0 sibling.
    if (!prev || v.severity_score > prev.severity_score) {
      map.set(key, v);
    }
  }
  return Array.from(map.values());
}
