import type { AffectedRange } from "@refuse/shared";

/**
 * Per-ecosystem version comparison and range matching. Implementations live in
 * sibling files (semver.ts, pypi.ts, ...) and are dispatched via getMatcher().
 *
 * Semantics (spec §7.1):
 * - isAffected: does `version` fall within ANY of the supplied affected ranges?
 *   A range with `introduced=A, fixed=B` matches `A <= v < B`.
 *   A range with `introduced=A, last_affected=L` matches `A <= v <= L`.
 *   `introduced` defaults to "0" / earliest possible if absent.
 * - minimumSafeUpgrade: the smallest version in `availableVersions` that is
 *   >= currentVersion AND not affected. Returns null if no such version exists.
 * - isBreakingChange: a heuristic for "is this an upgrade across an unstable
 *   boundary." Used to flag suggested fixes; not a hard guarantee.
 */
export interface VersionMatcher {
  isAffected(version: string, ranges: AffectedRange[]): boolean;
  minimumSafeUpgrade(
    currentVersion: string,
    ranges: AffectedRange[],
    availableVersions: string[],
  ): string | null;
  isBreakingChange(from: string, to: string): boolean;
}
