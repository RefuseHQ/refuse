import { describe, it, expect } from "vitest";
import { dpkgMatcher } from "./dpkg";
import type { AffectedRange } from "@refuse/shared";

describe("dpkgMatcher.isAffected", () => {
  it("compares simple Debian versions", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.1.1n-0+deb11u3" }];
    expect(dpkgMatcher.isAffected("1.1.1n-0+deb11u2", ranges)).toBe(true);
    expect(dpkgMatcher.isAffected("1.1.1n-0+deb11u3", ranges)).toBe(false);
    expect(dpkgMatcher.isAffected("1.1.1n-0+deb11u4", ranges)).toBe(false);
  });

  it("respects epochs (epoch ranks above upstream)", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1:1.0" }];
    expect(dpkgMatcher.isAffected("999.0", ranges)).toBe(true);
    expect(dpkgMatcher.isAffected("1:0.5", ranges)).toBe(true);
    expect(dpkgMatcher.isAffected("1:1.0", ranges)).toBe(false);
  });

  it("respects Debian revision suffixes", () => {
    // 2.4.41-4ubuntu3.14 < 2.4.41-4ubuntu3.15
    const ranges: AffectedRange[] = [
      { introduced: "0", fixed: "2.4.41-4ubuntu3.15" },
    ];
    expect(dpkgMatcher.isAffected("2.4.41-4ubuntu3.14", ranges)).toBe(true);
    expect(dpkgMatcher.isAffected("2.4.41-4ubuntu3.15", ranges)).toBe(false);
  });

  it("treats tilde as less than nothing (pre-release marker)", () => {
    // 1.0~rc1 < 1.0
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0" }];
    expect(dpkgMatcher.isAffected("1.0~rc1", ranges)).toBe(true);
    expect(dpkgMatcher.isAffected("1.0", ranges)).toBe(false);
  });

  it("returns false on unparseable version (fail-open)", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0" }];
    expect(dpkgMatcher.isAffected("", ranges)).toBe(false);
  });
});

describe("dpkgMatcher.minimumSafeUpgrade", () => {
  it("picks the smallest safe version >= current", () => {
    const ranges: AffectedRange[] = [
      { introduced: "0", fixed: "2.4.41-4ubuntu3.15" },
    ];
    const available = [
      "2.4.41-4ubuntu3.13",
      "2.4.41-4ubuntu3.14",
      "2.4.41-4ubuntu3.15",
      "2.4.52-1ubuntu4",
    ];
    expect(
      dpkgMatcher.minimumSafeUpgrade("2.4.41-4ubuntu3.14", ranges, available),
    ).toBe("2.4.41-4ubuntu3.15");
  });
});
