import { describe, it, expect } from "vitest";
import { pypiMatcher } from "./pypi";
import type { AffectedRange } from "@refuse/shared";

describe("pypiMatcher.isAffected", () => {
  it("CVE-2018-18074 requests: vulnerable < 2.20.0", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "2.20.0" }];
    expect(pypiMatcher.isAffected("2.19.1", ranges)).toBe(true);
    expect(pypiMatcher.isAffected("2.19.0", ranges)).toBe(true);
    expect(pypiMatcher.isAffected("2.20.0", ranges)).toBe(false);
    expect(pypiMatcher.isAffected("2.32.5", ranges)).toBe(false);
  });

  it("orders pre-releases below the corresponding release", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0", fixed: "1.0" }];
    // 1.0a1 < 1.0 → not within [1.0, 1.0)
    expect(pypiMatcher.isAffected("1.0a1", ranges)).toBe(false);
  });

  it("ranges that explicitly include a pre-release", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0a1", fixed: "1.0" }];
    expect(pypiMatcher.isAffected("1.0a1", ranges)).toBe(true);
    expect(pypiMatcher.isAffected("1.0a2", ranges)).toBe(true);
    expect(pypiMatcher.isAffected("1.0b1", ranges)).toBe(true);
    expect(pypiMatcher.isAffected("1.0", ranges)).toBe(false);
  });

  it("handles PEP 440 epochs (1! > all non-epoch versions)", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1!1.0" }];
    expect(pypiMatcher.isAffected("999.0.0", ranges)).toBe(true);
    expect(pypiMatcher.isAffected("1!0.5", ranges)).toBe(true);
    expect(pypiMatcher.isAffected("1!1.0", ranges)).toBe(false);
  });

  it("handles post-releases as later than the base release", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0", fixed: "1.0.post1" }];
    expect(pypiMatcher.isAffected("1.0", ranges)).toBe(true);
    expect(pypiMatcher.isAffected("1.0.post1", ranges)).toBe(false);
    expect(pypiMatcher.isAffected("1.0.post2", ranges)).toBe(false);
  });

  it("respects last_affected", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0", last_affected: "1.4.2" }];
    expect(pypiMatcher.isAffected("1.4.2", ranges)).toBe(true);
    expect(pypiMatcher.isAffected("1.4.3", ranges)).toBe(false);
  });

  it("returns false on unparseable PEP 440 input (fail-open)", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "2.0.0" }];
    expect(pypiMatcher.isAffected("not-a-version", ranges)).toBe(false);
    expect(pypiMatcher.isAffected("", ranges)).toBe(false);
  });
});

describe("pypiMatcher.minimumSafeUpgrade", () => {
  it("picks the smallest non-affected version >= current", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "2.20.0" }];
    const available = ["2.18.0", "2.19.0", "2.19.1", "2.20.0", "2.32.5"];
    expect(pypiMatcher.minimumSafeUpgrade("2.19.0", ranges, available)).toBe("2.20.0");
  });

  it("never recommends a downgrade", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.5", fixed: "2.0" }];
    const available = ["1.4.5", "1.5", "1.5.2", "2.0", "2.1"];
    expect(pypiMatcher.minimumSafeUpgrade("1.5.2", ranges, available)).toBe("2.0");
  });

  it("filters out unparseable available versions", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "2.0" }];
    const available = ["1.5", "garbage", "2.0", "3.0"];
    expect(pypiMatcher.minimumSafeUpgrade("1.5", ranges, available)).toBe("2.0");
  });
});

describe("pypiMatcher.isBreakingChange", () => {
  it("flags major bumps", () => {
    expect(pypiMatcher.isBreakingChange("1.5.0", "2.0.0")).toBe(true);
    expect(pypiMatcher.isBreakingChange("0.9", "1.0")).toBe(true);
  });

  it("does not flag minor/patch bumps", () => {
    expect(pypiMatcher.isBreakingChange("1.5.0", "1.6.0")).toBe(false);
    expect(pypiMatcher.isBreakingChange("1.5.0", "1.5.99")).toBe(false);
  });
});
