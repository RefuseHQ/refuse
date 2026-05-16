import semver from "semver";
import type { AffectedRange } from "@refuse/shared";
import type { VersionMatcher } from "./types";

/**
 * Matcher for ecosystems whose versions are semver-compatible after light
 * normalization: npm, crates.io, Go, Hex, Pub, Packagist.
 *
 * Normalization handles:
 * - Leading `v` (Go: `v1.2.3`)
 * - Go's `+incompatible` build suffix
 * - 2-segment versions (Packagist: `1.0` → `1.0.0`) via `semver.coerce`
 * - Composer `dev-*` refs are treated as unmatchable (returns null)
 */

function normalize(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /^dev-/i.test(trimmed)) return null;

  const stripped = trimmed.replace(/^v/i, "").replace(/\+incompatible$/, "");

  const valid = semver.valid(stripped);
  if (valid) return valid;

  const coerced = semver.coerce(stripped, { includePrerelease: true });
  return coerced ? coerced.version : null;
}

function isAffectedByRange(version: string, range: AffectedRange): boolean {
  const v = normalize(version);
  if (v === null) return false;

  const introducedRaw = range.introduced;
  const introduced =
    introducedRaw && introducedRaw !== "0" ? normalize(introducedRaw) : null;
  const fixed = range.fixed ? normalize(range.fixed) : null;
  const lastAffected = range.last_affected ? normalize(range.last_affected) : null;

  if (introduced && semver.lt(v, introduced)) return false;
  if (fixed && semver.gte(v, fixed)) return false;
  if (lastAffected && semver.gt(v, lastAffected)) return false;

  return true;
}

function isAffected(version: string, ranges: AffectedRange[]): boolean {
  return ranges.some((r) => isAffectedByRange(version, r));
}

export const semverMatcher: VersionMatcher = {
  isAffected,

  minimumSafeUpgrade(currentVersion, ranges, availableVersions) {
    const current = normalize(currentVersion);

    const safe: Array<{ raw: string; norm: string }> = [];
    for (const raw of availableVersions) {
      const norm = normalize(raw);
      if (!norm) continue;
      if (current && semver.lt(norm, current)) continue;
      if (isAffected(raw, ranges)) continue;
      safe.push({ raw, norm });
    }

    safe.sort((a, b) => semver.compare(a.norm, b.norm));
    return safe[0]?.raw ?? null;
  },

  isBreakingChange(from, to) {
    const a = normalize(from);
    const b = normalize(to);
    if (!a || !b) return false;
    return semver.major(a) !== semver.major(b);
  },
};
