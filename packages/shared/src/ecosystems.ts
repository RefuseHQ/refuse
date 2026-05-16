/**
 * Ecosystem identifiers follow OSV's canonical casing exactly. Distro ecosystems
 * carry a version suffix (`Debian:12`, `Alpine:v3.19`). We preserve casing on
 * storage; agents may pass any casing and we normalize at the MCP boundary.
 */

export const LANGUAGE_ECOSYSTEMS = [
  "npm",
  "PyPI",
  "crates.io",
  "Go",
  "RubyGems",
  "Packagist",
  "Maven",
  "NuGet",
  "Hex",
  "Pub",
] as const;

export const CI_ECOSYSTEMS = ["GitHub Actions"] as const;

export const DISTRO_FAMILIES = [
  "Debian",
  "Ubuntu",
  "Alpine",
  "Rocky Linux",
  "Red Hat",
  "AlmaLinux",
  "Chainguard",
  "Bitnami",
] as const;

export type LanguageEcosystem = (typeof LANGUAGE_ECOSYSTEMS)[number];
export type CiEcosystem = (typeof CI_ECOSYSTEMS)[number];
export type DistroFamily = (typeof DISTRO_FAMILIES)[number];

/** OSV ecosystem string. Includes versioned distros like `Debian:12`. */
export type Ecosystem = string;

/**
 * Maps lowercase aliases to OSV-canonical casing for non-distro ecosystems.
 * Distro ecosystems are normalized separately (they carry a `:version` suffix).
 */
const ALIAS_TO_CANONICAL: Record<string, string> = {
  // Language
  npm: "npm",
  pypi: "PyPI",
  python: "PyPI",
  pip: "PyPI",
  cargo: "crates.io",
  "crates.io": "crates.io",
  "crates": "crates.io",
  rust: "crates.io",
  go: "Go",
  golang: "Go",
  "go modules": "Go",
  rubygems: "RubyGems",
  "ruby gems": "RubyGems",
  ruby: "RubyGems",
  gem: "RubyGems",
  packagist: "Packagist",
  composer: "Packagist",
  php: "Packagist",
  maven: "Maven",
  java: "Maven",
  nuget: "NuGet",
  ".net": "NuGet",
  dotnet: "NuGet",
  hex: "Hex",
  elixir: "Hex",
  pub: "Pub",
  dart: "Pub",
  flutter: "Pub",
  // CI
  "github actions": "GitHub Actions",
  "github-actions": "GitHub Actions",
  "gh actions": "GitHub Actions",
};

const LOWERCASE_DISTRO_TO_CANONICAL: Record<string, string> = {
  debian: "Debian",
  ubuntu: "Ubuntu",
  alpine: "Alpine",
  "rocky linux": "Rocky Linux",
  "rocky-linux": "Rocky Linux",
  rocky: "Rocky Linux",
  "red hat": "Red Hat",
  "red-hat": "Red Hat",
  rhel: "Red Hat",
  almalinux: "AlmaLinux",
  alma: "AlmaLinux",
  chainguard: "Chainguard",
  bitnami: "Bitnami",
};

/**
 * Normalize an ecosystem string to OSV-canonical casing.
 *
 * - Plain names: `pypi` → `PyPI`, `Cargo` → `crates.io`
 * - Distro names: `debian:12` → `Debian:12`, `alpine:V3.19` → `Alpine:v3.19`
 *
 * Returns null if the input cannot be mapped to a known ecosystem.
 */
export function normalizeEcosystem(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Distro form: "<family>:<version>"
  if (trimmed.includes(":")) {
    const [familyRaw, ...rest] = trimmed.split(":");
    if (familyRaw === undefined || rest.length === 0) return null;
    const family = LOWERCASE_DISTRO_TO_CANONICAL[familyRaw.trim().toLowerCase()];
    if (!family) return null;
    const version = rest.join(":").trim();
    if (!version) return null;
    return `${family}:${normalizeDistroVersion(family, version)}`;
  }

  const canonical = ALIAS_TO_CANONICAL[trimmed.toLowerCase()];
  return canonical ?? null;
}

/**
 * Returns the matcher family for a normalized ecosystem string. Used by the
 * version-matcher dispatcher in @refuse/versions.
 */
export type MatcherFamily =
  | "semver"
  | "pypi"
  | "rubygems"
  | "maven"
  | "nuget"
  | "dpkg"
  | "apk"
  | "rpm"
  | "github-actions";

export function matcherFamily(ecosystem: string): MatcherFamily | null {
  const normalized = normalizeEcosystem(ecosystem);
  if (!normalized) return null;

  // Distros first (they carry a `:` suffix).
  if (normalized.startsWith("Debian:") || normalized.startsWith("Ubuntu:")) return "dpkg";
  if (normalized.startsWith("Alpine:") || normalized.startsWith("Chainguard:")) return "apk";
  if (
    normalized.startsWith("Rocky Linux:") ||
    normalized.startsWith("Red Hat:") ||
    normalized.startsWith("AlmaLinux:")
  ) {
    return "rpm";
  }
  if (normalized.startsWith("Bitnami:")) return "semver"; // Bitnami repackages upstream — usually semver

  switch (normalized) {
    case "npm":
    case "crates.io":
    case "Go":
    case "Hex":
    case "Pub":
    case "Packagist":
      return "semver";
    case "PyPI":
      return "pypi";
    case "RubyGems":
      return "rubygems";
    case "Maven":
      return "maven";
    case "NuGet":
      return "nuget";
    case "GitHub Actions":
      return "github-actions";
    default:
      return null;
  }
}

/**
 * Normalize a distro version suffix. Alpine OSV uses `v3.19`; users may pass
 * `3.19`. Other families pass through unchanged after trimming.
 */
function normalizeDistroVersion(family: string, version: string): string {
  if (family === "Alpine" || family === "Chainguard") {
    if (!version.toLowerCase().startsWith("v")) return `v${version}`;
    return `v${version.slice(1)}`;
  }
  return version;
}

/**
 * Canonicalize a package name within an ecosystem. PyPI is case-insensitive and
 * treats `_` and `.` as equivalent to `-` (PEP 503). npm names are lowercase by
 * convention but we preserve as-given since OSV stores them verbatim.
 */
export function canonicalizePackageName(ecosystem: string, name: string): string {
  const trimmed = name.trim();
  if (ecosystem === "PyPI") {
    return trimmed.toLowerCase().replace(/[._-]+/g, "-");
  }
  return trimmed;
}
