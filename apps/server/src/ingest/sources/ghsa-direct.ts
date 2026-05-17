/**
 * Direct pull of GitHub Security Advisories. OSV reflects these too, but
 * with ~30 min lag — pulling directly closes the freshness gap.
 *
 * Endpoint: https://api.github.com/advisories
 * Auth: optional. Unauthenticated allows 60 req/hr; with a `GITHUB_TOKEN`
 * (env secret) we get 5,000/hr — comfortably enough for hourly pulls of the
 * latest few hundred entries.
 *
 * We map GHSA payload onto our existing `vulnerabilities` + `affected_packages`
 * shape so the cards/feed pick them up via the same publish path.
 */

import type { OsvRecord } from "@refuse/shared";

const GHSA_URL = "https://api.github.com/advisories";

interface GhsaPackage {
  ecosystem: string;
  name: string;
}
interface GhsaVuln {
  package: GhsaPackage;
  vulnerable_version_range?: string;
  patched_versions?: string;
  vulnerable_functions?: string[];
}
interface GhsaIdentifier {
  type: string;
  value: string;
}
interface GhsaAdvisory {
  ghsa_id: string;
  cve_id?: string | null;
  url: string;
  summary?: string;
  description?: string;
  severity?: string;
  cvss?: { score?: number; vector_string?: string };
  identifiers?: GhsaIdentifier[];
  references?: Array<{ url: string }>;
  vulnerabilities?: GhsaVuln[];
  published_at: string;
  updated_at: string;
  withdrawn_at?: string | null;
}

export interface GhsaPullResult {
  fetched: number;
  imported: number;
  cursor: string | null;
}

/**
 * Fetch one page of advisories ordered by `updated` desc and convert each to
 * an OSV record so the existing normalize/upsert path handles it.
 */
export async function pullGhsaPage(
  apiToken: string | undefined,
  perPage = 100,
  modifiedAfter?: string,
): Promise<{ records: OsvRecord[]; cursor: string | null }> {
  const params = new URLSearchParams({
    per_page: String(perPage),
    sort: "updated",
    direction: "desc"});
  if (modifiedAfter) params.set("modified", `>${modifiedAfter}`);

  const headers: Record<string, string> = {
    "User-Agent": "refuse-ingestion/1.0 (+https://github.com/RefuseHQ/refuse)",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28"};
  if (apiToken) headers.Authorization = `Bearer ${apiToken}`;

  const res = await fetch(`${GHSA_URL}?${params.toString()}`, { headers });
  if (!res.ok) {
    throw new Error(`GHSA ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const advisories = (await res.json()) as GhsaAdvisory[];

  const records: OsvRecord[] = advisories.map(toOsvRecord);
  // Cursor for the next pull is the oldest updated_at on this page; next call
  // requests `modified > lastSeen` so we don't reprocess.
  const lastUpdated =
    advisories.length > 0
      ? advisories[advisories.length - 1]!.updated_at
      : null;
  return { records, cursor: lastUpdated };
}

function toOsvRecord(g: GhsaAdvisory): OsvRecord {
  const aliases = (g.identifiers ?? [])
    .map((id) => id.value)
    .filter((v) => v && v !== g.ghsa_id);
  const severityList: { type: string; score: string }[] = [];
  if (g.cvss?.vector_string) {
    severityList.push({
      type: g.cvss.vector_string.startsWith("CVSS:4") ? "CVSS_V4" : "CVSS_V3",
      score: g.cvss.vector_string});
  } else if (typeof g.cvss?.score === "number") {
    severityList.push({ type: "CVSS_V3", score: String(g.cvss.score) });
  }

  const affected = (g.vulnerabilities ?? [])
    .filter((v) => v.package?.ecosystem && v.package.name)
    .map((v) => ({
      package: { ecosystem: v.package.ecosystem, name: v.package.name },
      ranges: parseRange(v.vulnerable_version_range, v.patched_versions)}));

  return {
    id: g.ghsa_id,
    aliases,
    summary: g.summary ?? g.ghsa_id,
    details: g.description ?? null,
    published: g.published_at,
    modified: g.updated_at,
    withdrawn: g.withdrawn_at ?? null,
    severity: severityList.length ? severityList : undefined,
    references: (g.references ?? []).map((r) => ({ type: "WEB", url: r.url })),
    affected} as unknown as OsvRecord;
}

function parseRange(
  vulnerable?: string,
  patched?: string,
): Array<{ type: string; events: Array<Record<string, string>> }> {
  // Best-effort. GHSA vulnerable_version_range examples:
  //   ">= 1.0.0, < 2.0.0"   "< 4.17.21"   "= 1.2.3"
  // We translate to OSV events. When ambiguous we emit the conservative form.
  const events: Array<Record<string, string>> = [];
  const introduced = /(?:>= ?|> ?)([^\s,]+)/.exec(vulnerable ?? "");
  events.push({ introduced: introduced?.[1] ?? "0" });
  const fixed = /(?:< ?|<= ?)([^\s,]+)/.exec(vulnerable ?? "");
  if (fixed) events.push({ fixed: fixed[1]! });
  else if (patched) {
    const m = /([^\s,]+)/.exec(patched);
    if (m) events.push({ fixed: m[1]! });
  }
  return [{ type: "ECOSYSTEM", events }];
}
