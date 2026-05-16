import { describe, it, expect } from "vitest";
import { rpmMatcher, rpmvercmp } from "./rpm";
import type { AffectedRange } from "@refuse/shared";

describe("rpmvercmp (low-level)", () => {
  it("compares simple versions", () => {
    expect(rpmvercmp("1.0", "1.0")).toBe(0);
    expect(rpmvercmp("1.0", "2.0")).toBe(-1);
    expect(rpmvercmp("2.0", "1.0")).toBe(1);
  });

  it("compares numeric segments numerically (10 > 9, not lex)", () => {
    expect(rpmvercmp("1.10", "1.9")).toBe(1);
    expect(rpmvercmp("1.2.10", "1.2.9")).toBe(1);
  });

  it("strips leading zeros in numeric runs", () => {
    expect(rpmvercmp("1.00", "1.0")).toBe(0);
    expect(rpmvercmp("1.005", "1.5")).toBe(0);
  });

  it("handles tilde as pre-release marker", () => {
    expect(rpmvercmp("1.0~rc1", "1.0")).toBe(-1);
    expect(rpmvercmp("1.0", "1.0~rc1")).toBe(1);
    expect(rpmvercmp("1.0~rc1", "1.0~rc2")).toBe(-1);
    expect(rpmvercmp("1.0~beta", "1.0~rc")).toBe(-1);
  });

  it("treats alpha suffix on numeric segment as greater", () => {
    // From rpm's own test suite (tests/rpmvercmp.at):
    expect(rpmvercmp("1.0a", "1.0")).toBe(1);
    expect(rpmvercmp("1.0", "1.0a")).toBe(-1);
  });

  it("compares letter runs lexicographically", () => {
    expect(rpmvercmp("1.aa", "1.ab")).toBe(-1);
    expect(rpmvercmp("1.b", "1.a")).toBe(1);
  });

  it("ranks more segments as greater (1.0 < 1.0.1)", () => {
    expect(rpmvercmp("1.0", "1.0.1")).toBe(-1);
    expect(rpmvercmp("1.0.1", "1.0")).toBe(1);
  });
});

describe("rpmMatcher.isAffected", () => {
  it("CVE shape: rocky-linux openssl vulnerable < 1:1.1.1k-7.el9_0", () => {
    const ranges: AffectedRange[] = [
      { introduced: "0", fixed: "1:1.1.1k-7.el9_0" },
    ];
    expect(rpmMatcher.isAffected("1:1.1.1k-6.el9", ranges)).toBe(true);
    expect(rpmMatcher.isAffected("1:1.1.1k-7.el9_0", ranges)).toBe(false);
    expect(rpmMatcher.isAffected("1:1.1.1k-7.el9_2", ranges)).toBe(false);
  });

  it("respects epoch", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1:1.0-1" }];
    expect(rpmMatcher.isAffected("999.0-1", ranges)).toBe(true);
    expect(rpmMatcher.isAffected("1:0.5-1", ranges)).toBe(true);
    expect(rpmMatcher.isAffected("1:1.0-1", ranges)).toBe(false);
  });

  it("compares version then release", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0-2" }];
    expect(rpmMatcher.isAffected("1.0-1", ranges)).toBe(true);
    expect(rpmMatcher.isAffected("1.0-2", ranges)).toBe(false);
    expect(rpmMatcher.isAffected("1.0-3", ranges)).toBe(false);
  });

  it("treats tilde as pre-release in version field", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0-1" }];
    expect(rpmMatcher.isAffected("1.0~rc1-1", ranges)).toBe(true);
    expect(rpmMatcher.isAffected("1.0-1", ranges)).toBe(false);
  });

  it("returns false on unparseable input", () => {
    const ranges: AffectedRange[] = [{ introduced: "0", fixed: "1.0-1" }];
    expect(rpmMatcher.isAffected("", ranges)).toBe(false);
  });
});

describe("rpmMatcher.minimumSafeUpgrade", () => {
  it("picks the smallest safe version >= current", () => {
    const ranges: AffectedRange[] = [
      { introduced: "0", fixed: "1:1.1.1k-7.el9_0" },
    ];
    const available = [
      "1:1.1.1k-5.el9",
      "1:1.1.1k-6.el9",
      "1:1.1.1k-7.el9_0",
      "1:1.1.1k-7.el9_2",
    ];
    expect(rpmMatcher.minimumSafeUpgrade("1:1.1.1k-6.el9", ranges, available)).toBe("1:1.1.1k-7.el9_0");
  });
});
