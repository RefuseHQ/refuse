import type { ParsedDependency, LockfileParser } from "./types";

/**
 * Parse Ruby `Gemfile.lock`. The format has multiple sections (`GEM`, `PATH`,
 * `GIT`, `PLATFORMS`, `DEPENDENCIES`, etc.); we extract from `GEM` only —
 * those are RubyGems-published packages with version pins. PATH/GIT entries
 * are local/git deps without canonical versions.
 *
 * GEM block layout:
 *   GEM
 *     remote: https://rubygems.org/
 *     specs:
 *       activemodel (7.0.4)
 *         activesupport (= 7.0.4)
 *       activesupport (7.0.4)
 *         ...
 */
export const parseGemfileLock: LockfileParser = (content) => {
  const out: ParsedDependency[] = [];
  const lines = content.split(/\r?\n/);

  let inGemSpecs = false;
  for (const rawLine of lines) {
    if (rawLine === "GEM" || rawLine.startsWith("GEM ")) {
      inGemSpecs = false;
      continue;
    }
    if (rawLine.match(/^[A-Z]+$/)) {
      // Hit another section header (PATH, GIT, DEPENDENCIES, etc.).
      inGemSpecs = false;
      continue;
    }
    if (rawLine.trim() === "specs:") {
      inGemSpecs = true;
      continue;
    }
    if (!inGemSpecs) continue;

    // Top-level package lines have indent 4; transitive constraints have indent 6.
    if (!/^ {4}\S/.test(rawLine)) continue;

    const m = /^ {4}([A-Za-z0-9._\-!]+)\s+\(([^)]+)\)\s*$/.exec(rawLine);
    if (!m) continue;
    out.push({ ecosystem: "RubyGems", name: m[1]!, version: m[2]! });
  }

  return out;
};
