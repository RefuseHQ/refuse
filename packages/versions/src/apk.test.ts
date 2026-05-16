import { describe, it, expect } from "vitest";
import { apkMatcher } from "./apk";
import type { AffectedRange } from "@refuse/shared";

describe("apkMatcher.isAffected", () => {
  it("compares simple Alpine versions: openssl 1.1.1n-r0 < 1.1.1q-r0", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.1.1q-r0" }];
    expect(apkMatcher.isAffected("1.1.1n-r0", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.1.1p-r0", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.1.1q-r0", ranges)).toBe(false);
    expect(apkMatcher.isAffected("1.1.1w-r0", ranges)).toBe(false);
  });

  it("respects revision suffix `-rN`", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.1.1n-r3" }];
    expect(apkMatcher.isAffected("1.1.1n-r0", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.1.1n-r2", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.1.1n-r3", ranges)).toBe(false);
    expect(apkMatcher.isAffected("1.1.1n-r4", ranges)).toBe(false);
  });

  it("respects letter suffix on numeric segment (1.1.1n < 1.1.1o)", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.1.1n", last_affected: "1.1.1n" }];
    expect(apkMatcher.isAffected("1.1.1n", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.1.1o", ranges)).toBe(false);
    expect(apkMatcher.isAffected("1.1.1m", ranges)).toBe(false);
  });

  it("respects epoch (epoch ranks above all)", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1:1.0" }];
    expect(apkMatcher.isAffected("999.0", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1:0.5", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1:1.0", ranges)).toBe(false);
  });

  it("orders pre-suffixes below release: _alpha < _beta < _pre < _rc < release", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0_alpha1", fixed: "1.0" }];
    expect(apkMatcher.isAffected("1.0_alpha1", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.0_beta", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.0_rc1", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.0", ranges)).toBe(false);
  });

  it("orders post-suffix `_p` above release", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0", fixed: "1.0_p1" }];
    expect(apkMatcher.isAffected("1.0", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.0_p1", ranges)).toBe(false);
  });

  it("treats trailing zero segments as equivalent", () => {
    const ranges: AffectedRange[] = [{ introduced: "1.0", last_affected: "1.0" }];
    expect(apkMatcher.isAffected("1.0", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.0.0", ranges)).toBe(true);
    expect(apkMatcher.isAffected("1.0.1", ranges)).toBe(false);
  });

  it("returns false on unparseable input", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0" }];
    expect(apkMatcher.isAffected("totally garbage", ranges)).toBe(false);
    expect(apkMatcher.isAffected("", ranges)).toBe(false);
  });
});

describe("apkMatcher.minimumSafeUpgrade", () => {
  it("picks the smallest safe version >= current", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.1.1q-r0" }];
    const available = ["1.1.1n-r0", "1.1.1p-r0", "1.1.1q-r0", "1.1.1w-r0"];
    expect(apkMatcher.minimumSafeUpgrade("1.1.1n-r0", ranges, available)).toBe("1.1.1q-r0");
  });
});
