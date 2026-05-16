import { describe, it, expect } from "vitest";
import { getMatcher } from "./index";

describe("getMatcher dispatches to the right matcher per ecosystem", () => {
  it("returns the semver matcher for npm/Cargo/Go/Hex/Pub/Packagist", () => {
    expect(getMatcher("npm")).toBeDefined();
    expect(getMatcher("Cargo")).toBeDefined();
    expect(getMatcher("Go")).toBeDefined();
    expect(getMatcher("Hex")).toBeDefined();
    expect(getMatcher("Pub")).toBeDefined();
    expect(getMatcher("Packagist")).toBeDefined();
  });

  it("returns ecosystem-specific matchers", () => {
    expect(getMatcher("PyPI")).toBeDefined();
    expect(getMatcher("RubyGems")).toBeDefined();
    expect(getMatcher("Maven")).toBeDefined();
    expect(getMatcher("NuGet")).toBeDefined();
    expect(getMatcher("Debian:12")).toBeDefined();
    expect(getMatcher("Ubuntu:22.04")).toBeDefined();
    expect(getMatcher("Alpine:v3.19")).toBeDefined();
    expect(getMatcher("Rocky Linux:9")).toBeDefined();
    expect(getMatcher("GitHub Actions")).toBeDefined();
  });

  it("smoke-tests dispatch via real-shape calls", () => {
    expect(
      getMatcher("npm").isAffected("4.17.20", [{ introduced: "0", fixed: "4.17.21" }]),
    ).toBe(true);
    expect(
      getMatcher("PyPI").isAffected("2.19.0", [{ introduced: "0", fixed: "2.20.0" }]),
    ).toBe(true);
    expect(
      getMatcher("Maven").isAffected("2.14.0", [{ introduced: "2.13.0", fixed: "2.15.0" }]),
    ).toBe(true);
    expect(
      getMatcher("Alpine:v3.19").isAffected("1.1.1n-r0", [
        { introduced: "0", fixed: "1.1.1q-r0" },
      ]),
    ).toBe(true);
  });

  it("throws on unknown ecosystems", () => {
    expect(() => getMatcher("frobnitz")).toThrow(/Unsupported ecosystem/);
  });
});
