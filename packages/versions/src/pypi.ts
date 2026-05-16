import * as pep440 from "@renovatebot/pep440";
import type { AffectedRange } from "@refuse/shared";
import type { VersionMatcher } from "./types";

/**
 * PyPI uses PEP 440 versioning, which is similar in shape to semver but with
 * extras: epochs (`1!1.0`), local versions (`1.0+abi3`), pre/post/dev releases
 * (`1.0a1`, `1.0.post1`, `1.0.dev1`), and segment counts other than three.
 *
 * We delegate parsing and comparison to @renovatebot/pep440.
 */

function isValid(v: string): boolean {
  return v.length > 0 && pep440.valid(v) !== null;
}

function compare(a: string, b: string): number {
  return pep440.compare(a, b);
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

export const pypiMatcher: VersionMatcher = {
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
    if (!isValid(from) || !isValid(to)) return false;
    return pep440.major(from) !== pep440.major(to);
  },
};
