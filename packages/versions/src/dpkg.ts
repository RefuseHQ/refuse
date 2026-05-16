import compareDpkg from "dpkg-compare-versions";
import type { AffectedRange } from "@refuse/shared";
import type { VersionMatcher } from "./types";

/**
 * Debian/Ubuntu use dpkg version comparison: `[epoch:]upstream[-debian_revision]`.
 * Examples: `2:1.18.1-1`, `2.4.41-4ubuntu3.14`.
 *
 * We delegate to dpkg-compare-versions which mirrors `dpkg --compare-versions`.
 * The lib throws on malformed input; we catch and treat as unparseable.
 */

function safeCompare(a: string, b: string): number | null {
  try {
    return compareDpkg(a, b);
  } catch {
    return null;
  }
}

function isValid(v: string): boolean {
  return v.length > 0 && safeCompare(v, v) === 0;
}

function isAffectedByRange(version: string, range: AffectedRange): boolean {
  if (!isValid(version)) return false;

  const introducedRaw = range.introduced;
  const introduced =
    introducedRaw && introducedRaw !== "0" && isValid(introducedRaw)
      ? introducedRaw
      : null;
  const fixed = range.fixed && isValid(range.fixed) ? range.fixed : null;
  const lastAffected =
    range.last_affected && isValid(range.last_affected) ? range.last_affected : null;

  const cmp = (a: string, b: string): number => safeCompare(a, b) ?? 0;

  if (introduced && cmp(version, introduced) < 0) return false;
  if (fixed && cmp(version, fixed) >= 0) return false;
  if (lastAffected && cmp(version, lastAffected) > 0) return false;

  return true;
}

function isAffected(version: string, ranges: AffectedRange[]): boolean {
  return ranges.some((r) => isAffectedByRange(version, r));
}

export const dpkgMatcher: VersionMatcher = {
  isAffected,

  minimumSafeUpgrade(currentVersion, ranges, availableVersions) {
    const safe: string[] = [];
    for (const v of availableVersions) {
      if (!isValid(v)) continue;
      if (isValid(currentVersion) && (safeCompare(v, currentVersion) ?? 0) < 0) continue;
      if (isAffected(v, ranges)) continue;
      safe.push(v);
    }
    safe.sort((a, b) => safeCompare(a, b) ?? 0);
    return safe[0] ?? null;
  },

  isBreakingChange(_from, _to) {
    // dpkg versions don't have a clear semver-style major boundary in general;
    // distros track upstream majors but we can't infer reliably. Conservative.
    return false;
  },
};
