import { z } from "zod";
import { classifyLicense, type LicenseCategory } from "@refuse/shared";

/**
 * deps.dev v3 API client. Used to look up "what's the latest stable version of
 * X?" without hitting npm/PyPI/Maven directly. We only call this for packages
 * that already have at least one advisory (else the data set is too large).
 *
 * Docs: https://docs.deps.dev/api/v3/
 */

const DEPS_DEV_BASE = "https://api.deps.dev/v3";

/** Maps OSV-canonical ecosystem strings to deps.dev system names. */
const OSV_TO_DEPS_DEV_SYSTEM: Record<string, string> = {
  npm: "npm",
  PyPI: "pypi",
  "crates.io": "cargo",
  Go: "go",
  Maven: "maven",
  NuGet: "nuget"};

const VersionResp = z.object({
  versionKey: z.object({
    system: z.string(),
    name: z.string(),
    version: z.string()}),
  isDefault: z.boolean().optional(),
  publishedAt: z.string().optional(),
  // Pre-release indicator varies; we infer below if missing.
  isPrerelease: z.boolean().optional()});

const PackageResp = z.object({
  packageKey: z.object({
    system: z.string(),
    name: z.string()}),
  versions: z.array(VersionResp)});

export interface DepsDevPackage {
  ecosystem: string;
  name: string;
  versions: Array<{
    version: string;
    is_prerelease: boolean;
    is_yanked: boolean;
    released_at: string | null;
  }>;
}

export interface DepsDevVersionLicense {
  spdx: string | null;
  category: LicenseCategory;
}

export interface DepsDevFetcher {
  /**
   * Fetch all versions for a package. Returns null if deps.dev doesn't track
   * this ecosystem (e.g. RubyGems, Hex, Pub) or the package is missing.
   */
  getPackageVersions(ecosystem: string, name: string): Promise<DepsDevPackage | null>;
  /**
   * Fetch the SPDX license expression for a single version. Returns null when
   * the ecosystem isn't covered or the version is missing. Used to populate
   * package-level license info on the KV card — deps.dev exposes licenses
   * only on the per-version endpoint, not on the package list response.
   */
  getVersionLicense(
    ecosystem: string,
    name: string,
    version: string,
  ): Promise<DepsDevVersionLicense | null>;
}

export interface DepsDevFetcherDeps {
  fetch?: typeof globalThis.fetch;
}

/** Heuristic: a version is pre-release if it carries a non-numeric suffix. */
function inferPrerelease(version: string): boolean {
  // Common pre-release markers across ecosystems.
  return /(?:[-_]|\.dev|\.rc|\.a|\.b|\.beta|\.alpha)/i.test(version) ||
    /[a-z]/i.test(version.replace(/^v/i, "").replace(/^\d+(?:\.\d+){0,3}/, ""));
}

const VersionDetailResp = z
  .object({
    versionKey: z.object({
      system: z.string(),
      name: z.string(),
      version: z.string()}),
    licenses: z.array(z.string()).optional()})
  .passthrough();

export function createDepsDevFetcher(deps: DepsDevFetcherDeps = {}): DepsDevFetcher {
  const f = deps.fetch ?? globalThis.fetch;

  return {
    async getPackageVersions(ecosystem, name) {
      const system = OSV_TO_DEPS_DEV_SYSTEM[ecosystem];
      if (!system) return null;

      const url = `${DEPS_DEV_BASE}/systems/${system}/packages/${encodeURIComponent(name)}`;
      const res = await f(url);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`deps.dev ${res.status} for ${ecosystem}/${name}`);
      }
      const json = await res.json();
      const parsed = PackageResp.safeParse(json);
      if (!parsed.success) {
        throw new Error(
          `deps.dev response failed schema for ${ecosystem}/${name}: ${parsed.error.message}`,
        );
      }

      return {
        ecosystem,
        name,
        versions: parsed.data.versions.map((v) => ({
          version: v.versionKey.version,
          is_prerelease: v.isPrerelease ?? inferPrerelease(v.versionKey.version),
          is_yanked: false, // deps.dev doesn't expose yank status uniformly
          released_at: v.publishedAt ?? null}))};
    },

    async getVersionLicense(ecosystem, name, version) {
      const system = OSV_TO_DEPS_DEV_SYSTEM[ecosystem];
      if (!system) return null;
      const url =
        `${DEPS_DEV_BASE}/systems/${system}/packages/${encodeURIComponent(name)}` +
        `/versions/${encodeURIComponent(version)}`;
      const res = await f(url);
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`deps.dev ${res.status} for ${ecosystem}/${name}@${version}`);
      }
      const json = await res.json();
      const parsed = VersionDetailResp.safeParse(json);
      if (!parsed.success) return null;
      const { spdx, category } = classifyLicense(parsed.data.licenses);
      return { spdx, category };
    }};
}

/** Identify the latest non-prerelease version, falling back to the latest if none. */
export function pickLatest(pkg: DepsDevPackage): { latest_stable: string | null; latest_any: string | null } {
  const stable = pkg.versions.filter((v) => !v.is_prerelease && !v.is_yanked);
  const any = pkg.versions.filter((v) => !v.is_yanked);
  const sorter = (a: { released_at: string | null }, b: { released_at: string | null }): number => {
    if (a.released_at && b.released_at) return a.released_at < b.released_at ? 1 : -1;
    if (a.released_at) return -1;
    if (b.released_at) return 1;
    return 0;
  };
  stable.sort(sorter);
  any.sort(sorter);
  return {
    latest_stable: stable[0]?.version ?? null,
    latest_any: any[0]?.version ?? null};
}
