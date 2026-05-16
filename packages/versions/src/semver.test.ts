import { describe, it, expect } from "vitest";
import { semverMatcher } from "./semver";
import type { AffectedRange } from "@refuse/shared";

/**
 * Real CVE fixtures used as tests. Each fixture matches the OSV-derived ranges
 * we'd normalize from upstream advisories.
 */

describe("semverMatcher.isAffected", () => {
  it("CVE-2021-23337 lodash: vulnerable < 4.17.21", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "4.17.21" }];
    expect(semverMatcher.isAffected("4.17.20", ranges)).toBe(true);
    expect(semverMatcher.isAffected("4.17.10", ranges)).toBe(true);
    expect(semverMatcher.isAffected("0.0.1", ranges)).toBe(true);
    expect(semverMatcher.isAffected("4.17.21", ranges)).toBe(false);
    expect(semverMatcher.isAffected("4.17.22", ranges)).toBe(false);
    expect(semverMatcher.isAffected("5.0.0", ranges)).toBe(false);
  });

  it("CVE-2021-44906 minimist: vulnerable < 1.2.6", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.2.6" }];
    expect(semverMatcher.isAffected("1.2.5", ranges)).toBe(true);
    expect(semverMatcher.isAffected("1.2.6", ranges)).toBe(false);
  });

  it("treats `introduced: 0` and missing `introduced` identically", () => {
    const a: AffectedRange[] = [{ introduced: "0", fixed: "2.0.0" }];
    const b: AffectedRange[] = [{ fixed: "2.0.0" }];
    expect(semverMatcher.isAffected("1.5.0", a)).toBe(true);
    expect(semverMatcher.isAffected("1.5.0", b)).toBe(true);
  });

  it("respects `last_affected` (inclusive upper bound)", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0.0", last_affected: "1.4.2" }];
    expect(semverMatcher.isAffected("1.0.0", ranges)).toBe(true);
    expect(semverMatcher.isAffected("1.4.2", ranges)).toBe(true);
    expect(semverMatcher.isAffected("1.4.3", ranges)).toBe(false);
    expect(semverMatcher.isAffected("0.9.9", ranges)).toBe(false);
  });

  it("matches when only `introduced` is set (no known fix)", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0.0" }];
    expect(semverMatcher.isAffected("1.0.0", ranges)).toBe(true);
    expect(semverMatcher.isAffected("99.0.0", ranges)).toBe(true);
    expect(semverMatcher.isAffected("0.9.0", ranges)).toBe(false);
  });

  it("matches across multiple disjoint ranges", () => {
    const ranges: AffectedRange[] = [
      { introduced: "0", fixed: "2.20.0" },
      { introduced: "3.0.0", fixed: "3.5.1" },
    ];
    expect(semverMatcher.isAffected("1.0.0", ranges)).toBe(true);
    expect(semverMatcher.isAffected("2.20.0", ranges)).toBe(false);
    expect(semverMatcher.isAffected("2.99.0", ranges)).toBe(false);
    expect(semverMatcher.isAffected("3.0.0", ranges)).toBe(true);
    expect(semverMatcher.isAffected("3.5.0", ranges)).toBe(true);
    expect(semverMatcher.isAffected("3.5.1", ranges)).toBe(false);
  });

  it("normalizes Go `v`-prefix and `+incompatible`", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "v3.5.0" }];
    expect(semverMatcher.isAffected("v3.4.0", ranges)).toBe(true);
    expect(semverMatcher.isAffected("v3.5.0", ranges)).toBe(false);
    expect(semverMatcher.isAffected("v2.0.0+incompatible", ranges)).toBe(true);
  });

  it("normalizes Packagist 2-segment versions via coerce", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "2.7.51" }];
    expect(semverMatcher.isAffected("2.7", ranges)).toBe(true);
    expect(semverMatcher.isAffected("2.8", ranges)).toBe(false);
  });

  it("treats Composer dev-* refs as unmatchable (fail-open)", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "2.0.0" }];
    expect(semverMatcher.isAffected("dev-master", ranges)).toBe(false);
    expect(semverMatcher.isAffected("dev-main", ranges)).toBe(false);
  });

  it("orders prereleases below their release counterpart", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0.0", fixed: "1.0.0" }];
    // 1.0.0-rc.1 is < 1.0.0, so introduced=1.0.0 would NOT match.
    expect(semverMatcher.isAffected("1.0.0-rc.1", ranges)).toBe(false);
    // But ranges including pre-release versions explicitly:
    const ranges2: AffectedRange[] = [{ introduced: "1.0.0-rc.1", fixed: "1.0.0" }];
    expect(semverMatcher.isAffected("1.0.0-rc.1", ranges2)).toBe(true);
    expect(semverMatcher.isAffected("1.0.0-rc.2", ranges2)).toBe(true);
    expect(semverMatcher.isAffected("1.0.0", ranges2)).toBe(false);
  });

  it("returns false on unparseable version (fail-open per spec §10.8)", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "2.0.0" }];
    expect(semverMatcher.isAffected("not-a-version", ranges)).toBe(false);
    expect(semverMatcher.isAffected("", ranges)).toBe(false);
  });
});

describe("semverMatcher.minimumSafeUpgrade", () => {
  it("picks the smallest version >= current that is not affected", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "4.17.21" }];
    const available = ["4.17.19", "4.17.20", "4.17.21", "4.17.22", "5.0.0"];
    expect(semverMatcher.minimumSafeUpgrade("4.17.20", ranges, available)).toBe("4.17.21");
  });

  it("never recommends downgrading", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.5.0", fixed: "2.0.0" }];
    const available = ["1.4.0", "1.4.5", "1.5.0", "1.5.1", "2.0.0", "2.1.0"];
    // current 1.5.5 — 1.4.x is older and would be safe but downgrade not allowed.
    expect(semverMatcher.minimumSafeUpgrade("1.5.5", ranges, available)).toBe("2.0.0");
  });

  it("returns null when no safe version exists at or above current", () => {
    const ranges: AffectedRange[] = [{ introduced: "0" }]; // no known fix
    const available = ["1.0.0", "1.1.0", "1.2.0"];
    expect(semverMatcher.minimumSafeUpgrade("1.0.0", ranges, available)).toBeNull();
  });

  it("skips disjoint affected ranges to find next safe", () => {
    const ranges: AffectedRange[] = [
      { introduced: "0", fixed: "2.20.0" },
      { introduced: "3.0.0", fixed: "3.5.1" },
    ];
    const available = ["2.19.0", "2.20.0", "3.0.0", "3.5.0", "3.5.1"];
    // current 2.19.0 → next safe is 2.20.0.
    expect(semverMatcher.minimumSafeUpgrade("2.19.0", ranges, available)).toBe("2.20.0");
    // current 3.0.0 → next safe is 3.5.1.
    expect(semverMatcher.minimumSafeUpgrade("3.0.0", ranges, available)).toBe("3.5.1");
  });

  it("ignores unparseable available versions", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "2.0.0" }];
    const available = ["1.5.0", "garbage", "2.0.0", "dev-main"];
    expect(semverMatcher.minimumSafeUpgrade("1.5.0", ranges, available)).toBe("2.0.0");
  });

  it("when current is unparseable, picks smallest safe overall", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "2.0.0" }];
    const available = ["1.5.0", "2.0.0", "2.1.0"];
    expect(semverMatcher.minimumSafeUpgrade("garbage", ranges, available)).toBe("2.0.0");
  });
});

describe("semverMatcher.isBreakingChange", () => {
  it("flags major bumps as breaking", () => {
    expect(semverMatcher.isBreakingChange("1.2.3", "2.0.0")).toBe(true);
    expect(semverMatcher.isBreakingChange("3.5.1", "4.0.0")).toBe(true);
  });

  it("does not flag minor or patch bumps as breaking", () => {
    expect(semverMatcher.isBreakingChange("1.2.3", "1.3.0")).toBe(false);
    expect(semverMatcher.isBreakingChange("1.2.3", "1.2.99")).toBe(false);
  });

  it("returns false on unparseable inputs", () => {
    expect(semverMatcher.isBreakingChange("garbage", "1.0.0")).toBe(false);
    expect(semverMatcher.isBreakingChange("1.0.0", "garbage")).toBe(false);
  });
});
