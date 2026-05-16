import { describe, it, expect } from "vitest";
import { mavenMatcher } from "./maven";
import type { AffectedRange } from "@refuse/shared";

describe("mavenMatcher.isAffected", () => {
  it("CVE-2021-44228 log4j-core: vulnerable in [2.13.0, 2.15.0)", () => {
    const ranges: AffectedRange[] = [
      { introduced: "2.0-beta9", fixed: "2.3.2" },
      { introduced: "2.4", fixed: "2.12.4" },
      { introduced: "2.13.0", fixed: "2.15.0" },
    ];
    expect(mavenMatcher.isAffected("2.14.0", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("2.14.1", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("2.15.0", ranges)).toBe(false);
    expect(mavenMatcher.isAffected("2.16.0", ranges)).toBe(false);
    // Boundary cases for the other ranges:
    expect(mavenMatcher.isAffected("2.3.1", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("2.3.2", ranges)).toBe(false);
    expect(mavenMatcher.isAffected("2.12.3", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("2.12.4", ranges)).toBe(false);
  });

  it("treats trailing zeros and `.RELEASE`/`.GA`/`.FINAL` as no-ops", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0.0", last_affected: "1.0.0" }];
    expect(mavenMatcher.isAffected("1.0", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("1.0.0", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("1.0.0.RELEASE", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("1.0.0.GA", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("1.0.0.FINAL", ranges)).toBe(true);
  });

  it("orders pre-release qualifiers below stable", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0.0", fixed: "1.0.0" }];
    // All pre-releases are < 1.0.0, so not within [1.0.0, 1.0.0)
    expect(mavenMatcher.isAffected("1.0.0-alpha", ranges)).toBe(false);
    expect(mavenMatcher.isAffected("1.0.0-beta", ranges)).toBe(false);
    expect(mavenMatcher.isAffected("1.0.0-milestone", ranges)).toBe(false);
    expect(mavenMatcher.isAffected("1.0.0-rc", ranges)).toBe(false);
    expect(mavenMatcher.isAffected("1.0.0-snapshot", ranges)).toBe(false);
    expect(mavenMatcher.isAffected("1.0.0-SNAPSHOT", ranges)).toBe(false);
  });

  it("orders pre-release qualifiers among themselves: alpha < beta < milestone < rc < snapshot", () => {
    const ranges: AffectedRange[] = [
      { introduced: "1.0-alpha", fixed: "1.0-rc" },
    ];
    expect(mavenMatcher.isAffected("1.0-alpha", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("1.0-beta", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("1.0-milestone", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("1.0-rc", ranges)).toBe(false);
    expect(mavenMatcher.isAffected("1.0-snapshot", ranges)).toBe(false);
  });

  it("inserts `-` at letter↔digit boundaries (`2.0-beta9` < `2.0-beta10`)", () => {
    const ranges: AffectedRange[] = [
      { introduced: "2.0-beta9", fixed: "2.0-beta10" },
    ];
    expect(mavenMatcher.isAffected("2.0-beta9", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("2.0-beta10", ranges)).toBe(false);
  });

  it("expands qualifier shortcuts: a/b/m/cr", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0-a1", fixed: "1.0-a2" }];
    expect(mavenMatcher.isAffected("1.0-a1", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("1.0-alpha-1", ranges)).toBe(true); // canonical form
    expect(mavenMatcher.isAffected("1.0-a2", ranges)).toBe(false);
  });

  it("treats `sp` as ranking above release", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0", fixed: "1.0-sp" }];
    expect(mavenMatcher.isAffected("1.0", ranges)).toBe(true);
    expect(mavenMatcher.isAffected("1.0-sp", ranges)).toBe(false);
  });

  it("returns false on unparseable input", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0" }];
    expect(mavenMatcher.isAffected("not_a_version", ranges)).toBe(false);
    expect(mavenMatcher.isAffected("", ranges)).toBe(false);
  });
});

describe("mavenMatcher.minimumSafeUpgrade", () => {
  it("picks the smallest safe version >= current across log4j ranges", () => {
    const ranges: AffectedRange[] = [
      { introduced: "2.13.0", fixed: "2.15.0" },
    ];
    const available = ["2.13.0", "2.14.0", "2.14.1", "2.15.0", "2.16.0", "2.17.1"];
    expect(mavenMatcher.minimumSafeUpgrade("2.14.0", ranges, available)).toBe("2.15.0");
  });
});

describe("mavenMatcher.isBreakingChange", () => {
  it("flags major bumps", () => {
    expect(mavenMatcher.isBreakingChange("2.14.0", "3.0.0")).toBe(true);
  });
  it("does not flag minor bumps", () => {
    expect(mavenMatcher.isBreakingChange("2.14.0", "2.15.0")).toBe(false);
  });
});
