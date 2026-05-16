import { describe, it, expect } from "vitest";
import { nugetMatcher } from "./nuget";
import type { AffectedRange } from "@refuse/shared";

describe("nugetMatcher.isAffected", () => {
  it("compares 3-segment versions like semver", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "4.7.2" }];
    expect(nugetMatcher.isAffected("4.7.1", ranges)).toBe(true);
    expect(nugetMatcher.isAffected("4.7.2", ranges)).toBe(false);
  });

  it("treats `1.0.0.0` as equal to `1.0.0`", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0.0", last_affected: "1.0.0" }];
    expect(nugetMatcher.isAffected("1.0.0.0", ranges)).toBe(true);
    expect(nugetMatcher.isAffected("1.0.0", ranges)).toBe(true);
  });

  it("respects the 4th segment (Revision)", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0.0.5" }];
    expect(nugetMatcher.isAffected("1.0.0.4", ranges)).toBe(true);
    expect(nugetMatcher.isAffected("1.0.0.5", ranges)).toBe(false);
    expect(nugetMatcher.isAffected("1.0.0.6", ranges)).toBe(false);
  });

  it("orders pre-releases below stable", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0.0", fixed: "1.0.0" }];
    // 1.0.0-beta < 1.0.0 → outside [1.0.0, 1.0.0)
    expect(nugetMatcher.isAffected("1.0.0-beta", ranges)).toBe(false);
  });

  it("orders pre-release identifiers correctly", () => {
    const ranges: AffectedRange[] = [
      { introduced: "1.0.0-beta", fixed: "1.0.0-beta.5" },
    ];
    expect(nugetMatcher.isAffected("1.0.0-beta", ranges)).toBe(true);
    expect(nugetMatcher.isAffected("1.0.0-beta.2", ranges)).toBe(true);
    expect(nugetMatcher.isAffected("1.0.0-beta.5", ranges)).toBe(false);
    // Numeric < string: 1.0.0-beta.5 < 1.0.0-beta.alpha
    expect(nugetMatcher.isAffected("1.0.0-beta.alpha", ranges)).toBe(false);
  });

  it("ignores +build metadata for ordering", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0.0", fixed: "1.0.0" }];
    expect(nugetMatcher.isAffected("1.0.0+meta", ranges)).toBe(false);
  });

  it("accepts 2-segment versions and returns false on unparseable input", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.1" }];
    expect(nugetMatcher.isAffected("1.0", ranges)).toBe(true); // 1.0 < 1.1
    expect(nugetMatcher.isAffected("1.1", ranges)).toBe(false);
    expect(nugetMatcher.isAffected("not-a-version", ranges)).toBe(false);
    expect(nugetMatcher.isAffected("", ranges)).toBe(false);
  });
});

describe("nugetMatcher.minimumSafeUpgrade", () => {
  it("picks the smallest safe version >= current", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0.0.5" }];
    const available = ["1.0.0.3", "1.0.0.4", "1.0.0.5", "1.0.1"];
    expect(nugetMatcher.minimumSafeUpgrade("1.0.0.4", ranges, available)).toBe("1.0.0.5");
  });
});

describe("nugetMatcher.isBreakingChange", () => {
  it("flags major bumps", () => {
    expect(nugetMatcher.isBreakingChange("4.7.2", "5.0.0")).toBe(true);
  });
  it("does not flag minor bumps", () => {
    expect(nugetMatcher.isBreakingChange("4.7.2", "4.8.0")).toBe(false);
  });
});
