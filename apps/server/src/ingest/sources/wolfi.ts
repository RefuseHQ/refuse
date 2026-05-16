/**
 * Wolfi advisories — distroless / hardened-image vulnerability data published
 * by Chainguard. Source: github.com/wolfi-dev/advisories (YAML files).
 *
 * We pull the master JSON aggregator the Wolfi team exposes for OSV-style
 * consumption: `https://packages.wolfi.dev/os/security.json`. It's an
 * advisories list per package with secfixes per release.
 *
 * For an MVP we fetch the JSON, flatten to OSV-shape advisories with
 * ecosystem="Wolfi", and let the existing normalize/upsert path handle the
 * rest. This is best-effort — Wolfi's schema is closer to alpine secdb than
 * OSV.
 */

import type { OsvRecord } from "@refuse/shared";

const WOLFI_URL = "https://packages.wolfi.dev/os/security.json";

interface WolfiSecfix {
  [version: string]: string[]; // version → list of CVE/GHSA IDs fixed
}
interface WolfiPackage {
  pkg: { name: string; secfixes?: WolfiSecfix };
}
interface WolfiCatalog {
  apkurl?: string;
  archs?: string[];
  packages?: WolfiPackage[];
}

export interface WolfiPullResult {
  packages: number;
  records: number;
}

export async function pullWolfi(): Promise<{ records: OsvRecord[]; stats: WolfiPullResult }> {
  const res = await fetch(WOLFI_URL, {});
  if (!res.ok) throw new Error(`Wolfi fetch ${res.status}`);
  const catalog = (await res.json()) as WolfiCatalog;
  const out: OsvRecord[] = [];
  const packages = catalog.packages ?? [];

  // Each package lists secfixes per fix version. Group by CVE id so one OSV
  // record represents one CVE × Wolfi package, with the fix version as the
  // first OSV `events` entry.
  for (const entry of packages) {
    const name = entry.pkg?.name;
    if (!name) continue;
    // cve → first fix version we see
    const cveToFix = new Map<string, string>();
    for (const [version, cves] of Object.entries(entry.pkg.secfixes ?? {})) {
      // Wolfi uses "0" for "fixed in all versions" — treat as null fix
      // (everything's safe). Skip those entries.
      if (version === "0") continue;
      for (const cve of cves ?? []) {
        if (!/^CVE-/.test(cve)) continue;
        if (!cveToFix.has(cve)) cveToFix.set(cve, version);
      }
    }
    for (const [cve, fixVersion] of cveToFix) {
      out.push({
        // Suffix the OSV id so we don't collide with the canonical CVE record
        // ingested via OSV (each Wolfi advisory is a different bridge from
        // CVE → Wolfi package).
        id: `${cve}-WOLFI-${name}`,
        aliases: [cve],
        summary: `${name}: ${cve}`,
        details: null,
        // We don't have the original CVE publish date from Wolfi's feed;
        // use a stable placeholder rather than ingestion time so the
        // marketing feed doesn't render every Wolfi advisory as "1m ago".
        published: "2024-01-01T00:00:00Z",
        modified: nowIso(),
        withdrawn: null,
        affected: [
          {
            package: { ecosystem: "Wolfi", name },
            ranges: [
              {
                type: "ECOSYSTEM",
                events: [{ introduced: "0" }, { fixed: fixVersion }]},
            ]},
        ],
        references: []} as unknown as OsvRecord);
    }
  }
  return { records: out, stats: { packages: packages.length, records: out.length } };
}

function nowIso(): string {
  return new Date().toISOString();
}
