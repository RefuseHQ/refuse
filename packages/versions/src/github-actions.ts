import type { AffectedRange } from "@refuse/shared";
import type { VersionMatcher } from "./types";

/**
 * GitHub Actions versions are git refs, not semver — `actions/checkout@v3`,
 * `actions/checkout@a81bbbf...` (full SHA). OSV records affected refs as
 * an explicit list (each range has only `introduced`, treated as the affected
 * ref itself; advisories often list one range per affected tag).
 *
 * Strategy:
 * - Match if the input ref equals any range's introduced or last_affected.
 * - Recognize tag-vs-SHA equivalence ONLY when both sides happen to be SHAs
 *   (we don't have a tag→SHA resolver here). Tag aliases like `v3` vs
 *   `v3.0.0` are NOT considered equivalent — agents typically pin to the
 *   exact ref the workflow uses.
 */

const SHA_RE = /^[a-f0-9]{40}$/i;

function normalize(ref: string): string {
  return ref.trim();
}

function refMatches(a: string, b: string): boolean {
  const x = normalize(a);
  const y = normalize(b);
  if (x === y) return true;
  // Both full SHAs: case-insensitive match.
  if (SHA_RE.test(x) && SHA_RE.test(y)) {
    return x.toLowerCase() === y.toLowerCase();
  }
  return false;
}

function isAffectedByRange(ref: string, range: AffectedRange): boolean {
  if (range.introduced && refMatches(ref, range.introduced)) return true;
  if (range.last_affected && refMatches(ref, range.last_affected)) return true;
  return false;
}

export const githubActionsMatcher: VersionMatcher = {
  isAffected(ref, ranges) {
    return ranges.some((r) => isAffectedByRange(ref, r));
  },

  minimumSafeUpgrade(_currentRef, ranges, availableRefs) {
    for (const ref of availableRefs) {
      if (!ranges.some((r) => isAffectedByRange(ref, r))) return ref;
    }
    return null;
  },

  isBreakingChange(_from, _to) {
    // Refs are opaque — we can't know without metadata. Conservative default.
    return false;
  },
};
