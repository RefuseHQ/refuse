import { describe, it, expect } from "vitest";
import { githubActionsMatcher } from "./github-actions";
import type { AffectedRange } from "@refuse/shared";

describe("githubActionsMatcher.isAffected", () => {
  it("matches an exact tag", () => {
    const ranges: AffectedRange[] = [{ introduced: "v2" }];
    expect(githubActionsMatcher.isAffected("v2", ranges)).toBe(true);
    expect(githubActionsMatcher.isAffected("v3", ranges)).toBe(false);
  });

  it("matches against last_affected", () => {
    const ranges: AffectedRange[] = [{ last_affected: "v3.5.2" }];
    expect(githubActionsMatcher.isAffected("v3.5.2", ranges)).toBe(true);
    expect(githubActionsMatcher.isAffected("v3.5.3", ranges)).toBe(false);
  });

  it("treats `v3` and `v3.0.0` as distinct refs", () => {
    const ranges: AffectedRange[] = [{ introduced: "v3" }];
    expect(githubActionsMatcher.isAffected("v3.0.0", ranges)).toBe(false);
  });

  it("compares full SHAs case-insensitively", () => {
    const sha = "a81bbbf8298c0fa03ea29cdc473d45769f953675";
    const ranges: AffectedRange[] = [{ introduced: sha }];
    expect(githubActionsMatcher.isAffected(sha.toUpperCase(), ranges)).toBe(true);
    expect(githubActionsMatcher.isAffected("a81bbbf", ranges)).toBe(false); // not a full SHA
  });

  it("matches across multiple ranges (multi-tag advisory)", () => {
    const ranges: AffectedRange[] = [
      { introduced: "v1" },
      { introduced: "v2" },
      { introduced: "v3.0.0" },
    ];
    expect(githubActionsMatcher.isAffected("v1", ranges)).toBe(true);
    expect(githubActionsMatcher.isAffected("v2", ranges)).toBe(true);
    expect(githubActionsMatcher.isAffected("v3.0.0", ranges)).toBe(true);
    expect(githubActionsMatcher.isAffected("v4", ranges)).toBe(false);
  });
});

describe("githubActionsMatcher.minimumSafeUpgrade", () => {
  it("returns the first available ref not in the affected list", () => {
    const ranges: AffectedRange[] = [{ introduced: "v1" }, { introduced: "v2" }];
    expect(githubActionsMatcher.minimumSafeUpgrade("v2", ranges, ["v3", "v4"])).toBe("v3");
  });

  it("returns null if every available ref is affected", () => {
    const ranges: AffectedRange[] = [{ introduced: "v1" }, { introduced: "v2" }];
    expect(githubActionsMatcher.minimumSafeUpgrade("v1", ranges, ["v1", "v2"])).toBeNull();
  });
});

describe("githubActionsMatcher.isBreakingChange", () => {
  it("conservatively reports false", () => {
    expect(githubActionsMatcher.isBreakingChange("v2", "v3")).toBe(false);
  });
});
