import type { AffectedRange } from "@refuse/shared";
import type { VersionMatcher } from "./types";

/**
 * NuGet versions: `Major.Minor.Patch[.Revision][-PreRelease][+Metadata]`
 *
 * Differences from semver:
 * - Optional 4th numeric segment (Revision). Trailing zeros equivalent
 *   (`1.0.0.0` == `1.0.0`).
 * - Pre-release identifiers compared like semver: numeric segments
 *   numerically, mixed types alphanumerically; pre-release ranks BELOW
 *   stable.
 * - Build metadata (`+...`) ignored for ordering.
 *
 * Source of truth: NuGet.Versioning/NuGetVersion.Compare.cs in NuGet/NuGet.Client.
 */

interface ParsedNuGet {
  core: number[];                       // 1-4 numeric segments, normalized
  pre: Array<number | string> | null;   // null = stable
}

const VALID_RE = /^[0-9]+(?:\.[0-9]+){0,3}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(raw: string): ParsedNuGet | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^v/i, "");
  if (!VALID_RE.test(trimmed)) return null;

  const [verAndPre] = trimmed.split("+", 1);
  if (!verAndPre) return null;

  const dashIdx = verAndPre.indexOf("-");
  const corePart = dashIdx === -1 ? verAndPre : verAndPre.slice(0, dashIdx);
  const prePart = dashIdx === -1 ? null : verAndPre.slice(dashIdx + 1);

  const core = corePart.split(".").map((s) => Number(s));
  if (core.some((n) => Number.isNaN(n))) return null;
  while (core.length < 4) core.push(0);
  // Strip trailing zeros down to a minimum of 3 segments, since
  // [1, 2, 3, 0] and [1, 2, 3] should compare as equal but we want
  // a consistent representation for the comparator.
  while (core.length > 3 && core[core.length - 1] === 0) core.pop();

  const pre =
    prePart === null
      ? null
      : prePart.split(".").map((s) => (/^\d+$/.test(s) ? Number(s) : s));

  return { core, pre };
}

function compareCore(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function comparePre(
  a: Array<number | string>,
  b: Array<number | string>,
): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    // Shorter pre-release wins ties — semver §11: "A larger set of pre-release
    // fields has a higher precedence than a smaller set, if all of the
    // preceding identifiers are equal."
    if (x === undefined) return -1;
    if (y === undefined) return 1;

    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x < y ? -1 : 1;
    } else if (typeof x === "string" && typeof y === "string") {
      if (x !== y) return x < y ? -1 : 1;
    } else {
      // Mixed: numeric ranks lower (semver §11 rule 4).
      return typeof x === "number" ? -1 : 1;
    }
  }
  return 0;
}

function compare(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;

  const c = compareCore(pa.core, pb.core);
  if (c !== 0) return c;

  // Stable > prerelease.
  if (pa.pre === null && pb.pre === null) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return comparePre(pa.pre, pb.pre);
}

function isValid(v: string): boolean {
  return parse(v) !== null;
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

export const nugetMatcher: VersionMatcher = {
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
    const a = parse(from);
    const b = parse(to);
    if (!a || !b) return false;
    return (a.core[0] ?? 0) !== (b.core[0] ?? 0);
  },
};
