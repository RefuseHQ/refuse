import {
  type OsvRecord,
  type OsvAffected,
  type AffectedRange,
  type CardAdvisory,
  type LicenseInfo,
  type VulnCard,
  scoreToLabel,
  type SeverityLabel,
  canonicalizePackageName} from "@refuse/shared";

/**
 * Result of normalizing a single OSV record. We split the record into:
 *
 * - One `vulnerability` row (refuse_id, summary, severity, raw OSV blob)
 * - Zero or more `affected_package` rows (one per affected ecosystem/package)
 *
 * The KV vuln card is computed at publish time (publish-cards.ts) by joining
 * across all advisories that affect a given (ecosystem, package_name).
 */

export interface NormalizedVulnerability {
  refuse_id: string;
  primary_id: string;
  aliases: string[];          // includes primary_id
  summary: string;
  details: string | null;
  severity_score: number | null;
  severity_label: SeverityLabel;
  severity_vector: string | null;
  references: string[];
  published_at: string;
  modified_at: string;
  withdrawn_at: string | null;
  raw_osv: string;
  is_malicious: boolean;
}

export interface NormalizedAffectedPackage {
  refuse_id: string;
  ecosystem: string;
  package_name: string;
  ranges: AffectedRange[];
  fix_versions: string[];
}

export interface NormalizedRecord {
  vulnerability: NormalizedVulnerability;
  affected: NormalizedAffectedPackage[];
}

/* ─────────────── refuse_id ─────────────── */

/**
 * FNV-1a 64-bit hash, truncated to 12 hex chars (48 bits, ~2.8×10^14
 * namespace — collision rate < 1e-7 even at 1M records).
 */
function shortHash(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    hash = (hash ^ BigInt(input.charCodeAt(i))) & MASK;
    hash = (hash * PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0").slice(0, 12);
}

export function refuseIdFor(osvId: string, publishedYear: string): string {
  return `rfs-${publishedYear}-${shortHash(osvId)}`;
}

/* ─────────────── primary_id selection ─────────────── */

/**
 * Pick a stable, human-recognizable primary identifier. Preference order
 * matches what humans type into search bars:
 *   CVE > GHSA > the OSV id itself
 * If multiple CVEs/GHSAs exist, pick the lexicographically smallest for
 * determinism.
 */
export function pickPrimaryId(osvId: string, aliases: string[]): string {
  const all = [osvId, ...aliases];
  const cves = all.filter((a) => /^CVE-\d{4}-\d+$/.test(a)).sort();
  if (cves.length > 0) return cves[0]!;
  const ghsas = all.filter((a) => /^GHSA-/i.test(a)).sort();
  if (ghsas.length > 0) return ghsas[0]!;
  return osvId;
}

/**
 * Decide whether an OSV record represents a malicious-package report rather
 * than a traditional CVE-style vulnerability. Two signals:
 *
 *   1. The primary id or any alias starts with `MAL-` — OSV's prefix for
 *      malicious-package advisories (used by GHSA's malware feed and the
 *      OpenSSF malicious-packages dataset).
 *   2. The record carries `database_specific.malicious === true`. PyPI's
 *      malware advisories surface this way.
 *
 * We deliberately don't look at the `summary` text — false positives from
 * "malicious" appearing in CVE descriptions would dilute the signal.
 */
export function detectMalicious(record: OsvRecord): boolean {
  const ids = [record.id, ...(record.aliases ?? [])];
  if (ids.some((id) => /^MAL-/i.test(id))) return true;
  // OsvRecord uses passthrough() so unknown fields like database_specific
  // survive on the parsed object.
  const ds = (record as unknown as { database_specific?: unknown }).database_specific;
  if (ds && typeof ds === "object" && (ds as { malicious?: unknown }).malicious === true) {
    return true;
  }
  return false;
}

/* ─────────────── severity parsing ─────────────── */

import { calculateCvssBaseScore } from "./cvss";

/**
 * Extract the highest CVSS base score from an OSV severity list. Prefers v4
 * vectors over v3 when both are present. Falls back to publisher-supplied
 * numeric scores ("9.8") when the vector is unparseable.
 */
export function extractSeverity(record: OsvRecord): {
  score: number | null;
  label: SeverityLabel;
  vector: string | null;
} {
  const sevs = record.severity ?? [];
  // Prefer CVSS_V4 > CVSS_V3 > anything else.
  const ordered = [...sevs].sort((a, b) => {
    const rank = (t: string): number =>
      t === "CVSS_V4" ? 0 : t === "CVSS_V3" ? 1 : 2;
    return rank(a.type) - rank(b.type);
  });

  for (const sev of ordered) {
    const score = calculateCvssBaseScore(sev.score);
    if (score !== null) {
      return { score, label: scoreToLabel(score), vector: sev.score };
    }
  }
  return { score: null, label: "unknown", vector: null };
}

/* ─────────────── range conversion ─────────────── */

/**
 * Convert OSV `ranges[].events` into our flat AffectedRange triples.
 *
 * OSV events are an interleaved sequence: `[{introduced: "0"}, {fixed: "2.0"},
 * {introduced: "3.0"}, {fixed: "3.5"}]`. We pair `introduced` with the next
 * `fixed` or `last_affected` until the next `introduced` resets the pair.
 *
 * For range type "GIT" we currently skip — we don't track git refs in our
 * affected_packages table, only ecosystem versions.
 */
export function flattenRanges(affected: OsvAffected): AffectedRange[] {
  const out: AffectedRange[] = [];
  for (const range of affected.ranges ?? []) {
    if (range.type === "GIT") continue;
    let introduced: string | null = null;
    for (const event of range.events) {
      if (event.introduced !== undefined) {
        if (introduced !== null) {
          // Previous introduced had no closing event — emit as open-ended.
          out.push({ introduced });
        }
        introduced = event.introduced;
      } else if (event.fixed !== undefined) {
        out.push({ introduced: introduced ?? "0", fixed: event.fixed });
        introduced = null;
      } else if (event.last_affected !== undefined) {
        out.push({ introduced: introduced ?? "0", last_affected: event.last_affected });
        introduced = null;
      }
    }
    if (introduced !== null) {
      out.push({ introduced });
    }
  }
  return out;
}

/* ─────────────── normalize ─────────────── */

// Caps to keep INSERT statements under D1's per-statement limit (~64 KB observed).
// If you need the full record, fetch from OSV by primary_id.
const RAW_OSV_LIMIT = 16 * 1024;
const DETAILS_LIMIT = 8 * 1024;
const SUMMARY_LIMIT = 2 * 1024;
const REFS_MAX = 64;
const ALIASES_MAX = 64;
const RANGES_MAX = 32;
const FIX_VERSIONS_MAX = 32;

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 24)}…[trunc:${s.length}]` : s;
}

export function normalizeOsv(record: OsvRecord): NormalizedRecord | null {
  if (!record.id || !record.published || !record.modified) return null;

  const publishedYear = record.published.slice(0, 4);
  const refuse_id = refuseIdFor(record.id, publishedYear);
  const aliasesAll = Array.from(new Set([record.id, ...(record.aliases ?? [])]));
  const aliases = aliasesAll.slice(0, ALIASES_MAX);
  const primary_id = pickPrimaryId(record.id, record.aliases ?? []);
  const summary = truncate(record.summary ?? primary_id, SUMMARY_LIMIT);
  const { score, label, vector } = extractSeverity(record);
  const refs = (record.references ?? []).map((r) => r.url).slice(0, REFS_MAX);

  const fullRaw = JSON.stringify(record);
  const truncatedRaw = truncate(fullRaw, RAW_OSV_LIMIT);
  const detailsRaw = record.details ?? null;
  const truncatedDetails = detailsRaw ? truncate(detailsRaw, DETAILS_LIMIT) : null;

  const vulnerability: NormalizedVulnerability = {
    refuse_id,
    primary_id,
    aliases,
    summary,
    details: truncatedDetails,
    severity_score: score,
    severity_label: label,
    severity_vector: vector,
    references: refs,
    published_at: record.published,
    modified_at: record.modified,
    withdrawn_at: record.withdrawn ?? null,
    raw_osv: truncatedRaw,
    is_malicious: detectMalicious(record)};

  // Dedupe by (ecosystem, package_name) within this record. OSV records can
  // list the same package twice — e.g. one entry with an ECOSYSTEM range and
  // another with a GIT range — and the affected_packages PK forbids duplicates.
  // We merge their ranges and fix_versions.
  const affectedMap = new Map<string, NormalizedAffectedPackage>();
  for (const a of record.affected ?? []) {
    if (!a.package) continue;
    const ecosystem = a.package.ecosystem;
    const package_name = canonicalizePackageName(ecosystem, a.package.name);
    const ranges = flattenRanges(a);
    if (ranges.length === 0 && (a.versions ?? []).length === 0) continue;

    const key = `${ecosystem}::${package_name}`;
    const existing = affectedMap.get(key);
    if (existing) {
      existing.ranges.push(...ranges);
    } else {
      affectedMap.set(key, { refuse_id, ecosystem, package_name, ranges, fix_versions: [] });
    }
  }
  for (const a of affectedMap.values()) {
    if (a.ranges.length > RANGES_MAX) {
      a.ranges = a.ranges.slice(0, RANGES_MAX);
    }
    a.fix_versions = Array.from(
      new Set(a.ranges.map((r) => r.fixed).filter((v): v is string => Boolean(v))),
    ).slice(0, FIX_VERSIONS_MAX);
  }
  const affected = Array.from(affectedMap.values());

  return { vulnerability, affected };
}

/* ─────────────── card builder ─────────────── */

/**
 * Build a KV vuln card from N normalized records that all affect the same
 * (ecosystem, package_name). Caller is responsible for grouping by package.
 */
export function buildVulnCard(
  ecosystem: string,
  name: string,
  records: Array<{ vulnerability: NormalizedVulnerability; affected: NormalizedAffectedPackage }>,
  packageVersions: { latest_stable: string | null; latest_any: string | null; license?: LicenseInfo },
  now: string = new Date().toISOString(),
): VulnCard {
  const advisories: CardAdvisory[] = records.map(({ vulnerability, affected }) => ({
    refuse_id: vulnerability.refuse_id,
    primary_id: vulnerability.primary_id,
    aliases: vulnerability.aliases,
    summary: vulnerability.summary,
    severity_score: vulnerability.severity_score,
    severity_label: vulnerability.severity_label,
    ranges: affected.ranges,
    fix_versions: affected.fix_versions,
    references: vulnerability.references,
    ...(vulnerability.is_malicious ? { is_malicious: true } : {})}));

  return {
    ecosystem,
    name,
    advisories,
    latest_stable: packageVersions.latest_stable,
    latest_any: packageVersions.latest_any,
    updated_at: now,
    ...(packageVersions.license ? { license: packageVersions.license } : {})};
}
