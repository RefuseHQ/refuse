import type { LockfileParser } from "./types";

/**
 * Bun's text lockfile (`bun.lock`, JSON-ish, lockfileVersion 1+).
 *
 * Format example:
 *   {
 *     "lockfileVersion": 1,
 *     "workspaces": { "": { "dependencies": {...} } },
 *     "packages": {
 *       "@scope/name": ["@scope/name@1.2.3", "<registry>", { ...deps }, "sha512-..."],
 *       "name":        ["name@1.2.3",       "<registry>", {},          "sha512-..."]
 *     }
 *   }
 *
 * The file is JSON-with-trailing-commas (Bun emits `,}` and `,]` for diffability).
 * We strip trailing commas before parsing — every other field is plain JSON.
 *
 * From `packages[*][0]` we recover the `name@version` pair. Scoped packages
 * (`@scope/name@1.2.3`) need a careful split because they contain a `@` in
 * the name itself.
 */
export const parseBunLock: LockfileParser = (content) => {
  const cleaned = stripJsonComments(content).replace(/,(\s*[}\]])/g, "$1");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];

  const root = parsed as Record<string, unknown>;
  const packages = root.packages;
  if (!packages || typeof packages !== "object") return [];

  const out: { ecosystem: string; name: string; version: string }[] = [];
  for (const [, value] of Object.entries(packages as Record<string, unknown>)) {
    if (!Array.isArray(value) || value.length === 0) continue;
    const head = value[0];
    if (typeof head !== "string") continue;
    const split = splitNameAtVersion(head);
    if (!split) continue;
    if (!split.version) continue;
    out.push({ ecosystem: "npm", name: split.name, version: split.version });
  }
  return out;
};

function splitNameAtVersion(s: string): { name: string; version: string } | null {
  // Scoped: "@scope/name@version" — last "@" is the separator.
  // Unscoped: "name@version" — first "@" is the separator.
  if (s.startsWith("@")) {
    const lastAt = s.lastIndexOf("@");
    if (lastAt <= 0) return null;
    return { name: s.slice(0, lastAt), version: s.slice(lastAt + 1) };
  }
  const firstAt = s.indexOf("@");
  if (firstAt <= 0) return null;
  return { name: s.slice(0, firstAt), version: s.slice(firstAt + 1) };
}

/** Drop // line comments and /* block *\/ comments — Bun's writer doesn't
 * emit them today, but tolerating them keeps us future-proof. */
function stripJsonComments(s: string): string {
  return s
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}
