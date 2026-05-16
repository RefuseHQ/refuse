import { parse as parseYaml } from "yaml";
import type { ParsedDependency, LockfileParser } from "./types";

/**
 * Parse `pnpm-lock.yaml`. Modern pnpm (v6+) uses `packages:` keyed by
 * `/{name}/{version}` for non-scoped or `/{@scope/name}/{version}` for scoped
 * (or `/{name}@{version}` in v9+). We accept both forms.
 */
export const parsePnpmLockYaml: LockfileParser = (content) => {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    return [];
  }
  const root = parsed as { packages?: Record<string, unknown> };
  if (!root.packages) return [];

  const out: ParsedDependency[] = [];
  for (const key of Object.keys(root.packages)) {
    const pair = parsePackageKey(key);
    if (pair) out.push({ ecosystem: "npm", ...pair });
  }
  return out;
};

function parsePackageKey(key: string): { name: string; version: string } | null {
  // Strip peer-dep suffix like "(react@18.0.0)" first — those `@`s would
  // otherwise confuse the name/version split.
  const noPeer = key.split("(", 1)[0]!;
  const stripped = noPeer.startsWith("/") ? noPeer.slice(1) : noPeer;

  // pnpm v9+ format: "name@version" or "@scope/name@version"
  // The `@` we want is the LAST one (after any scope `@`), where the
  // remainder is a valid version (no `/`).
  const atIdx = stripped.lastIndexOf("@");
  if (atIdx > 0 && !stripped.slice(atIdx + 1).includes("/")) {
    const name = stripped.slice(0, atIdx);
    const version = stripped.slice(atIdx + 1);
    if (name && version) return { name, version };
  }

  // Older "/name/version" format (no `@` separator).
  const lastSlash = stripped.lastIndexOf("/");
  if (lastSlash > 0) {
    const name = stripped.slice(0, lastSlash);
    const version = stripped.slice(lastSlash + 1);
    if (name && version) return { name, version };
  }
  return null;
}
