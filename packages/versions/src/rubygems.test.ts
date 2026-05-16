import { describe, it, expect } from "vitest";
import { rubyGemsMatcher } from "./rubygems";
import type { AffectedRange } from "@refuse/shared";

describe("rubyGemsMatcher.isAffected", () => {
  it("CVE-2020-8165 activerecord/rails: vulnerable < 6.0.3.1", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "6.0.3.1" }];
    expect(rubyGemsMatcher.isAffected("6.0.3", ranges)).toBe(true);
    expect(rubyGemsMatcher.isAffected("6.0.3.1", ranges)).toBe(false);
    expect(rubyGemsMatcher.isAffected("6.1.0", ranges)).toBe(false);
  });

  it("orders pre-releases below the corresponding release", () => {
    expect(rubyGemsMatcher.isAffected("1.0.0", [{ introduced: "1.0.0.alpha", fixed: "1.0.0" }])).toBe(false);
    expect(rubyGemsMatcher.isAffected("1.0.0.alpha", [{ introduced: "1.0.0.alpha", fixed: "1.0.0" }])).toBe(true);
    expect(rubyGemsMatcher.isAffected("1.0.0.beta", [{ introduced: "1.0.0.alpha", fixed: "1.0.0" }])).toBe(true);
  });

  it("normalizes embedded letter/digit boundaries (`1.0.0a1` ≈ `1.0.0.a.1`)", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0.0" }];
    expect(rubyGemsMatcher.isAffected("1.0.0a1", ranges)).toBe(true);
    expect(rubyGemsMatcher.isAffected("1.0.0.a.1", ranges)).toBe(true);
  });

  it("treats trailing zeros as equivalent", () => {
    // 1.0 < 1.0.1 (real diff)
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0.1" }];
    expect(rubyGemsMatcher.isAffected("1.0", ranges)).toBe(true);
    expect(rubyGemsMatcher.isAffected("1.0.0", ranges)).toBe(true);
    expect(rubyGemsMatcher.isAffected("1.0.1", ranges)).toBe(false);
  });

  it("orders pre-releases lexicographically by string segment", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0.0.alpha", fixed: "1.0.0.beta" }];
    expect(rubyGemsMatcher.isAffected("1.0.0.alpha", ranges)).toBe(true);
    // 1.0.0.b is between alpha and beta? alphabetically "alpha" < "b" < "beta"
    expect(rubyGemsMatcher.isAffected("1.0.0.beta", ranges)).toBe(false);
    expect(rubyGemsMatcher.isAffected("1.0.0.rc1", ranges)).toBe(false);
  });

  it("returns false on unparseable input", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0" }];
    expect(rubyGemsMatcher.isAffected("not_a_version", ranges)).toBe(false);
    expect(rubyGemsMatcher.isAffected("", ranges)).toBe(false);
  });
});

describe("rubyGemsMatcher.minimumSafeUpgrade", () => {
  it("picks the smallest safe version >= current", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "6.0.3.1" }];
    const available = ["6.0.2", "6.0.3", "6.0.3.1", "6.1.0"];
    expect(rubyGemsMatcher.minimumSafeUpgrade("6.0.3", ranges, available)).toBe("6.0.3.1");
  });
});

describe("rubyGemsMatcher.isBreakingChange", () => {
  it("flags major bumps", () => {
    expect(rubyGemsMatcher.isBreakingChange("5.2.0", "6.0.0")).toBe(true);
  });
  it("does not flag minor bumps", () => {
    expect(rubyGemsMatcher.isBreakingChange("6.0.0", "6.1.0")).toBe(false);
  });
});
