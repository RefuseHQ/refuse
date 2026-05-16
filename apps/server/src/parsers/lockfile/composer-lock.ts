import type { ParsedDependency, LockfileParser } from "./types";

/**
 * Parse Composer `composer.lock`. Top-level `packages` and `packages-dev`
 * arrays, each entry has `name` (e.g. `symfony/console`) and `version`.
 * Versions starting with `dev-` are git-branch refs and can't be looked up
 * by version — we skip those.
 */
export const parseComposerLock: LockfileParser = (content) => {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return [];
  }

  const out: ParsedDependency[] = [];
  const root = json as {
    packages?: Array<{ name?: string; version?: string }>;
    "packages-dev"?: Array<{ name?: string; version?: string }>;
  };

  for (const pkg of [...(root.packages ?? []), ...(root["packages-dev"] ?? [])]) {
    if (!pkg.name || !pkg.version) continue;
    if (pkg.version.startsWith("dev-")) continue;
    const version = pkg.version.replace(/^v/, "");
    out.push({ ecosystem: "Packagist", name: pkg.name, version });
  }
  return out;
};
