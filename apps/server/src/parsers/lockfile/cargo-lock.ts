import toml from "@iarna/toml";
import type { ParsedDependency, LockfileParser } from "./types";

/**
 * Parse Rust `Cargo.lock`. Top-level `[[package]]` array, each with `name`,
 * `version`, optional `source`. Skip entries without a registry source
 * (those are local path/git deps with no published version to query).
 */
export const parseCargoLock: LockfileParser = (content) => {
  let parsed: unknown;
  try {
    parsed = toml.parse(content);
  } catch {
    return [];
  }
  const pkgs = (parsed as { package?: Array<{ name?: string; version?: string; source?: string }> }).package;
  if (!Array.isArray(pkgs)) return [];

  const out: ParsedDependency[] = [];
  for (const p of pkgs) {
    if (!p.name || !p.version) continue;
    if (p.source && !p.source.startsWith("registry+")) continue;
    out.push({ ecosystem: "crates.io", name: p.name, version: p.version });
  }
  return out;
};
