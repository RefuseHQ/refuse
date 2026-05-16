import { describe, it, expect } from "vitest";
import { normalizeEcosystem, matcherFamily, canonicalizePackageName } from "./ecosystems";

describe("normalizeEcosystem", () => {
  it("preserves canonical OSV casing", () => {
    expect(normalizeEcosystem("PyPI")).toBe("PyPI");
    expect(normalizeEcosystem("crates.io")).toBe("crates.io");
    expect(normalizeEcosystem("npm")).toBe("npm");
    expect(normalizeEcosystem("GitHub Actions")).toBe("GitHub Actions");
  });

  it("maps lowercase aliases to canonical", () => {
    expect(normalizeEcosystem("pypi")).toBe("PyPI");
    expect(normalizeEcosystem("python")).toBe("PyPI");
    expect(normalizeEcosystem("pip")).toBe("PyPI");
    expect(normalizeEcosystem("cargo")).toBe("crates.io");
    expect(normalizeEcosystem("rust")).toBe("crates.io");
    expect(normalizeEcosystem("golang")).toBe("Go");
    expect(normalizeEcosystem("composer")).toBe("Packagist");
    expect(normalizeEcosystem("github-actions")).toBe("GitHub Actions");
  });

  it("normalizes distro form: family:version", () => {
    expect(normalizeEcosystem("debian:12")).toBe("Debian:12");
    expect(normalizeEcosystem("Debian:11")).toBe("Debian:11");
    expect(normalizeEcosystem("ubuntu:22.04")).toBe("Ubuntu:22.04");
    expect(normalizeEcosystem("rocky-linux:9")).toBe("Rocky Linux:9");
  });

  it("adds the `v` prefix to Alpine versions", () => {
    expect(normalizeEcosystem("alpine:3.19")).toBe("Alpine:v3.19");
    expect(normalizeEcosystem("Alpine:V3.19")).toBe("Alpine:v3.19");
    expect(normalizeEcosystem("alpine:v3.19")).toBe("Alpine:v3.19");
  });

  it("returns null for unknown ecosystems", () => {
    expect(normalizeEcosystem("frobnitz")).toBeNull();
    expect(normalizeEcosystem("")).toBeNull();
    expect(normalizeEcosystem("debian:")).toBeNull();
    expect(normalizeEcosystem(":12")).toBeNull();
  });
});

describe("matcherFamily", () => {
  it("groups semver-native ecosystems", () => {
    expect(matcherFamily("npm")).toBe("semver");
    expect(matcherFamily("Cargo")).toBe("semver");
    expect(matcherFamily("Go")).toBe("semver");
    expect(matcherFamily("Hex")).toBe("semver");
    expect(matcherFamily("Pub")).toBe("semver");
    expect(matcherFamily("Packagist")).toBe("semver");
  });

  it("groups distro families correctly", () => {
    expect(matcherFamily("Debian:12")).toBe("dpkg");
    expect(matcherFamily("Ubuntu:22.04")).toBe("dpkg");
    expect(matcherFamily("Alpine:v3.19")).toBe("apk");
    expect(matcherFamily("Chainguard:rolling")).toBe("apk");
    expect(matcherFamily("Rocky Linux:9")).toBe("rpm");
    expect(matcherFamily("AlmaLinux:9")).toBe("rpm");
  });

  it("identifies non-semver language matchers", () => {
    expect(matcherFamily("PyPI")).toBe("pypi");
    expect(matcherFamily("RubyGems")).toBe("rubygems");
    expect(matcherFamily("Maven")).toBe("maven");
    expect(matcherFamily("NuGet")).toBe("nuget");
  });

  it("identifies github actions", () => {
    expect(matcherFamily("GitHub Actions")).toBe("github-actions");
    expect(matcherFamily("github-actions")).toBe("github-actions");
  });

  it("returns null for unknown ecosystems", () => {
    expect(matcherFamily("frobnitz")).toBeNull();
  });
});

describe("canonicalizePackageName", () => {
  it("PyPI is case-insensitive and treats _ and . as -", () => {
    expect(canonicalizePackageName("PyPI", "Django")).toBe("django");
    expect(canonicalizePackageName("PyPI", "Flask_Login")).toBe("flask-login");
    expect(canonicalizePackageName("PyPI", "zope.interface")).toBe("zope-interface");
    expect(canonicalizePackageName("PyPI", "PIL.Image")).toBe("pil-image");
  });

  it("preserves non-PyPI names verbatim", () => {
    expect(canonicalizePackageName("npm", "lodash")).toBe("lodash");
    expect(canonicalizePackageName("npm", "@scope/pkg")).toBe("@scope/pkg");
    expect(canonicalizePackageName("Maven", "org.apache.logging.log4j:log4j-core")).toBe(
      "org.apache.logging.log4j:log4j-core",
    );
  });
});
