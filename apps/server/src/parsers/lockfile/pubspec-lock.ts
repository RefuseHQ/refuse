import { parse as parseYaml } from "yaml";
import type { ParsedDependency, LockfileParser } from "./types";

/**
 * Parse Dart/Flutter `pubspec.lock`:
 *
 *   packages:
 *     http:
 *       dependency: "direct main"
 *       description:
 *         name: http
 *         sha256: ...
 *         url: "https://pub.dev"
 *       source: hosted
 *       version: "1.1.0"
 *
 * Only `source: hosted` entries map to pub.dev. `source: git` and
 * `source: path` are skipped.
 */
export const parsePubspecLock: LockfileParser = (content) => {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    return [];
  }
  const root = parsed as { packages?: Record<string, { source?: string; version?: string; description?: { name?: string } }> };
  if (!root.packages) return [];

  const out: ParsedDependency[] = [];
  for (const [key, info] of Object.entries(root.packages)) {
    if (info.source !== "hosted" || !info.version) continue;
    const name = info.description?.name ?? key;
    out.push({ ecosystem: "Pub", name, version: info.version });
  }
  return out;
};
