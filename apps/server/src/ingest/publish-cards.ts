import {
  type VulnCard,
  type CardAdvisory,
  type LicenseCategory,
  type AffectedRange,
  type SeverityLabel,
  scoreToLabel} from "@refuse/shared";
import type { AffectedKey } from "./upsert";

import type { D1LikeDatabase, D1Statement } from "../db/adapter";
import type { CardReader } from "../cards";
/**
 * KV vuln-card publisher. Given a set of (ecosystem, package_name) tuples
 * that may have changed, re-builds each card from D1 and writes it to KV.
 *
 * Key format: `card:v1:{ecosystem}:{package_name}`
 *
 * Spec §10.4: KV is eventually consistent (~60s globally). On write failure,
 * we log and let the next cron cycle retry — D1 has the truth.
 */

export const KV_CARD_PREFIX = "card:v1";

export function cardKeyFor(ecosystem: string, name: string): string {
  return `${KV_CARD_PREFIX}:${ecosystem}:${name}`;
}

interface AdvisoryJoinRow {
  refuse_id: string;
  primary_id: string;
  aliases: string;            // JSON
  summary: string;
  severity_score: number | null;
  severity_label: string | null;
  references_json: string | null;
  ranges_json: string;        // JSON
  fix_versions: string | null; // JSON
  withdrawn_at: string | null;
  is_malicious: number;
}

const ADVISORY_JOIN_SQL = `
  SELECT v.refuse_id, v.primary_id, v.aliases, v.summary,
         v.severity_score, v.severity_label, v.references_json,
         a.ranges_json, a.fix_versions, v.withdrawn_at, v.is_malicious
  FROM affected_packages a
  JOIN vulnerabilities v ON v.refuse_id = a.refuse_id
  WHERE a.ecosystem = ? AND a.package_name = ?
`;

const LATEST_VERSIONS_SQL = `
  SELECT version, is_prerelease, is_yanked, released_at, license_spdx, license_category
  FROM package_versions
  WHERE ecosystem = ? AND package_name = ?
  ORDER BY released_at DESC
`;

interface PackageVersionRow {
  version: string;
  is_prerelease: number;
  is_yanked: number;
  released_at: string | null;
  license_spdx: string | null;
  license_category: string | null;
}

export interface CardBuilderResult {
  key: string;
  card: VulnCard | null;   // null = no advisories remain → delete the key
}

export async function buildCardForPackage(
  db: D1LikeDatabase,
  ecosystem: string,
  name: string,
  now: string = new Date().toISOString(),
): Promise<CardBuilderResult> {
  const key = cardKeyFor(ecosystem, name);

  const advRes = await db
    .prepare(ADVISORY_JOIN_SQL)
    .bind(ecosystem, name)
    .all<AdvisoryJoinRow>();

  const live = (advRes.results ?? []).filter((r) => r.withdrawn_at === null);

  if (live.length === 0) {
    return { key, card: null };
  }

  // Pre-parse aliases so we can build a single batched lookup against the
  // KEV / EPSS tables — most cards have a few advisories, each with 1–3 CVE
  // aliases, so the union is small.
  const parsed = live.map((r) => ({
    row: r,
    aliases: parseJsonArray<string>(r.aliases)}));
  const allCves = new Set<string>();
  for (const { aliases } of parsed) {
    for (const a of aliases) if (/^CVE-/i.test(a)) allCves.add(a);
  }

  const kevById = new Map<string, { date_added: string; ransomware_use: number }>();
  const epssById = new Map<string, { score: number; percentile: number }>();
  if (allCves.size > 0) {
    const cveList = [...allCves];
    // D1 caps bound parameters at 100 per statement; chunk safely.
    const CHUNK = 90;
    for (let i = 0; i < cveList.length; i += CHUNK) {
      const slice = cveList.slice(i, i + CHUNK);
      const placeholders = slice.map(() => "?").join(",");
      const [kevRes, epssRes] = await Promise.all([
        db
          .prepare(
            `SELECT cve_id, date_added, ransomware_use FROM kev WHERE cve_id IN (${placeholders})`,
          )
          .bind(...slice)
          .all<{ cve_id: string; date_added: string; ransomware_use: number }>(),
        db
          .prepare(
            `SELECT cve_id, score, percentile FROM epss WHERE cve_id IN (${placeholders})`,
          )
          .bind(...slice)
          .all<{ cve_id: string; score: number; percentile: number }>(),
      ]);
      for (const k of kevRes.results ?? [])
        kevById.set(k.cve_id, { date_added: k.date_added, ransomware_use: k.ransomware_use });
      for (const e of epssRes.results ?? [])
        epssById.set(e.cve_id, { score: e.score, percentile: e.percentile });
    }
  }

  const advisories: CardAdvisory[] = parsed.map(({ row: r, aliases }) => {
    const ranges = parseJsonArray<AffectedRange>(r.ranges_json);
    const fix_versions = parseJsonArray<string>(r.fix_versions ?? "[]");
    const references = parseJsonArray<string>(r.references_json ?? "[]");
    const label = (r.severity_label as SeverityLabel | null) ??
      scoreToLabel(r.severity_score);

    // Pick the highest-signal KEV/EPSS hit across all CVE aliases.
    let kevHit: { date_added: string; ransomware_use: number } | null = null;
    let epssHit: { score: number; percentile: number } | null = null;
    for (const a of aliases) {
      if (!/^CVE-/i.test(a)) continue;
      const k = kevById.get(a);
      if (k && (!kevHit || k.date_added < kevHit.date_added)) kevHit = k;
      const e = epssById.get(a);
      if (e && (!epssHit || e.score > epssHit.score)) epssHit = e;
    }

    return {
      refuse_id: r.refuse_id,
      primary_id: r.primary_id,
      aliases,
      summary: r.summary,
      severity_score: r.severity_score,
      severity_label: label,
      ranges,
      fix_versions,
      references,
      ...(r.is_malicious === 1 ? { is_malicious: true } : {}),
      ...(kevHit
        ? {
            kev_listed: true,
            kev_added_at: kevHit.date_added,
            ransomware_use: kevHit.ransomware_use === 1}
        : {}),
      ...(epssHit
        ? {
            epss_score: epssHit.score,
            epss_percentile: epssHit.percentile}
        : {})};
  });

  const versionsRes = await db
    .prepare(LATEST_VERSIONS_SQL)
    .bind(ecosystem, name)
    .all<PackageVersionRow>();
  const versions = versionsRes.results ?? [];

  const latest_stable_row =
    versions.find((v) => !v.is_prerelease && !v.is_yanked) ?? null;
  const latest_stable = latest_stable_row?.version ?? null;
  const latest_any = versions.find((v) => !v.is_yanked)?.version ?? null;

  // Pull license from the latest stable row when available, falling back to
  // any row that has license metadata. v1 populates every row with the same
  // license string so this is mostly a presence check.
  const licenseSource =
    latest_stable_row && latest_stable_row.license_category
      ? latest_stable_row
      : versions.find((v) => v.license_category) ?? null;
  const license =
    licenseSource && licenseSource.license_category
      ? {
          spdx: licenseSource.license_spdx,
          category: licenseSource.license_category as LicenseCategory}
      : null;

  const card: VulnCard = {
    ecosystem,
    name,
    advisories,
    latest_stable,
    latest_any,
    updated_at: now,
    ...(license ? { license } : {})};

  return { key, card };
}

export async function publishCards(
  db: D1LikeDatabase,
  cards: CardReader,
  changed: AffectedKey[],
  opts: { concurrency?: number } = {},
): Promise<{ written: number; deleted: number; errors: Array<{ key: string; error: string }> }> {
  const concurrency = Math.min(Math.max(opts.concurrency ?? 16, 1), 64);
  let written = 0;
  let deleted = 0;
  const errors: Array<{ key: string; error: string }> = [];

  // Simple concurrency-limited fan-out. Workers handle ~50 in-flight
  // subrequests fine, but each card costs ~3 D1 reads + 1 KV write so we
  // cap conservatively to stay under per-invocation limits.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= changed.length) return;
      const { ecosystem, package_name } = changed[i]!;
      try {
        // In the OSS server cards are built on-the-fly by the reader. We
        // don't pre-publish them to a store; we invalidate the LRU so the
        // next read sees fresh data from SQLite. The buildCardForPackage
        // call is retained as a sanity probe — if it throws, we record the
        // error so operators can see the broken package.
        const { card } = await buildCardForPackage(db, ecosystem, package_name);
        cards.invalidate(ecosystem, package_name);
        if (card === null) deleted++;
        else written++;
      } catch (e) {
        errors.push({
          key: cardKeyFor(ecosystem, package_name),
          error: (e as Error).message,
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, changed.length) }, () => worker()),
  );

  return { written, deleted, errors };
}

/* ─────────── helpers ─────────── */

function parseJsonArray<T = unknown>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
