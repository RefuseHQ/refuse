import type { ParsedDependency, LockfileParser } from "./types";

/**
 * Parse Go `go.sum`. Each line is `module-path version[/go.mod] hash`. We pin
 * to the version of the module proper (lines with `/go.mod` are duplicates of
 * the same version; we dedupe).
 *
 * Versions like `v1.2.3-0.20210101000000-abcdef` are valid Go pseudo-versions;
 * we keep them as-is — the semver matcher handles them.
 */
export const parseGoSum: LockfileParser = (content) => {
  const out: ParsedDependency[] = [];
  const seen = new Set<string>();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^(\S+)\s+(\S+?)(?:\/go\.mod)?\s+h1:/.exec(line);
    if (!m) continue;
    const name = m[1]!;
    const version = m[2]!;
    const key = `${name}@${version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ecosystem: "Go", name, version });
  }

  return out;
};
