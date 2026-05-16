import type { ParsedDependency, LockfileParser } from "./types";

/**
 * `requirements.txt` parser. Only `==` exact-pin lines yield a usable version.
 * Lines like `package>=1.0,<2.0` (range specifiers), `git+...`, `-e .`,
 * `-r other.txt`, and comments are skipped — we can't lookup vulns without an
 * exact version.
 */
export const parseRequirementsTxt: LockfileParser = (content) => {
  const out: ParsedDependency[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("-")) continue; // -r, -e, -c flags
    if (line.startsWith("git+") || line.startsWith("file:") || line.startsWith("http")) continue;

    // Strip extras and environment markers: "django[bcrypt]==4.0; python_version>=3.8"
    const noMarker = line.split(";", 1)[0]!.trim();
    const noExtras = noMarker.replace(/\[[^\]]*\]/, "");

    const m = /^([A-Za-z0-9._-]+)\s*==\s*([^\s]+)$/.exec(noExtras);
    if (!m) continue;
    out.push({ ecosystem: "PyPI", name: m[1]!, version: m[2]! });
  }
  return out;
};

function stripComment(line: string): string {
  const i = line.indexOf("#");
  return i === -1 ? line : line.slice(0, i);
}
