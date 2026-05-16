import type { ParsedDependency, LockfileParser } from "./types";

/**
 * Parses `package-lock.json` (npm v3+ format). Walks the `packages` map; each
 * key is a path like `node_modules/foo` or `node_modules/foo/node_modules/bar`,
 * and the value contains `version`. The empty-string key is the project root
 * itself — we skip it.
 *
 * v1/v2 lockfiles also have a `dependencies` tree as a fallback, but every
 * lockfile from npm 7+ includes `packages`.
 */
export const parsePackageLockJson: LockfileParser = (content) => {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch {
    return [];
  }

  const out: ParsedDependency[] = [];
  const packages = (json as { packages?: Record<string, { version?: string; name?: string }> }).packages;
  if (packages) {
    for (const [path, info] of Object.entries(packages)) {
      if (path === "") continue; // root project
      const version = info.version;
      if (!version) continue;
      // Path looks like "node_modules/.pnpm/foo" or "node_modules/foo/node_modules/bar".
      // The actual package name is the segment after the LAST "node_modules/".
      const lastNm = path.lastIndexOf("node_modules/");
      const name =
        info.name ?? (lastNm !== -1 ? path.slice(lastNm + "node_modules/".length) : path);
      if (!name) continue;
      out.push({ ecosystem: "npm", name, version });
    }
    return out;
  }

  // Fallback to v1/v2 `dependencies` tree.
  const deps = (json as { dependencies?: Record<string, unknown> }).dependencies;
  if (deps) walkV1Tree(deps, out);
  return out;
};

function walkV1Tree(node: Record<string, unknown>, out: ParsedDependency[]): void {
  for (const [name, raw] of Object.entries(node)) {
    if (!raw || typeof raw !== "object") continue;
    const info = raw as { version?: string; dependencies?: Record<string, unknown> };
    if (info.version) {
      out.push({ ecosystem: "npm", name, version: info.version });
    }
    if (info.dependencies) walkV1Tree(info.dependencies, out);
  }
}
