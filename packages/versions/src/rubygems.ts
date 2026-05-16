import type { AffectedRange } from "@refuse/shared";
import type { VersionMatcher } from "./types";

/**
 * RubyGems versions follow Gem::Version semantics. Compared with the
 * approximation:
 *
 * 1. Insert dots at every letter↔digit boundary (`1.0.0a1` → `1.0.0.a.1`).
 * 2. Split on `.` and classify each segment as numeric or string.
 * 3. Compare segment-by-segment:
 *    - both numeric → numerically
 *    - both string  → lexicographically (case-sensitive, lowercase by convention)
 *    - mixed        → string segment ranks LOWER (so `1.0.0.alpha` < `1.0.0`)
 *    - missing segments default to 0
 *
 * Trailing zeros are equivalent under this rule (`1.0` == `1.0.0`).
 *
 * Source of truth: rubygems/lib/rubygems/version.rb#<=>
 */

const VALID_RE = /^[0-9a-zA-Z.\-]+$/;

function tokenize(raw: string): Array<number | string> | null {
  if (!raw || !VALID_RE.test(raw)) return null;
  // Treat `-` as a separator, mirroring `Gem::Version.new` which converts it.
  const expanded = raw
    .replace(/-/g, ".")
    .replace(/([0-9])([a-zA-Z])/g, "$1.$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1.$2");
  const parts = expanded.split(".").filter((p) => p.length > 0);
  if (parts.length === 0) return null;
  return parts.map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

function compareSegment(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  if (typeof a === "string" && typeof b === "string") {
    return a === b ? 0 : a < b ? -1 : 1;
  }
  // Mixed — string ranks lower than number.
  return typeof a === "string" ? -1 : 1;
}

function compare(a: string, b: string): number {
  const as = tokenize(a) ?? [];
  const bs = tokenize(b) ?? [];
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i++) {
    const x = as[i] ?? 0;
    const y = bs[i] ?? 0;
    const c = compareSegment(x, y);
    if (c !== 0) return c;
  }
  return 0;
}

function isValid(v: string): boolean {
  return tokenize(v) !== null;
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

  if (introduced && compare(version, introduced) < 0) return false;
  if (fixed && compare(version, fixed) >= 0) return false;
  if (lastAffected && compare(version, lastAffected) > 0) return false;

  return true;
}

function isAffected(version: string, ranges: AffectedRange[]): boolean {
  return ranges.some((r) => isAffectedByRange(version, r));
}

function majorOf(v: string): number | null {
  const t = tokenize(v);
  if (!t) return null;
  const first = t[0];
  return typeof first === "number" ? first : null;
}

export const rubyGemsMatcher: VersionMatcher = {
  isAffected,

  minimumSafeUpgrade(currentVersion, ranges, availableVersions) {
    const currentValid = isValid(currentVersion);
    const safe: string[] = [];
    for (const v of availableVersions) {
      if (!isValid(v)) continue;
      if (currentValid && compare(v, currentVersion) < 0) continue;
      if (isAffected(v, ranges)) continue;
      safe.push(v);
    }
    safe.sort(compare);
    return safe[0] ?? null;
  },

  isBreakingChange(from, to) {
    const a = majorOf(from);
    const b = majorOf(to);
    if (a === null || b === null) return false;
    return a !== b;
  },
};
