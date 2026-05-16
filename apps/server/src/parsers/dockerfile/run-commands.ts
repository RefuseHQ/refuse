import type { ParsedDependency } from "../lockfile/types";

/**
 * Parsers for `RUN` shell-form bodies. Extract `(ecosystem, name, version)`
 * triples for pinned package installs, and emit warnings for unpinned installs
 * or `curl ... | sh` patterns.
 *
 * The Dockerfile parser passes us the joined RUN body (line continuations
 * resolved). We tokenize at `&&` / `;` / `|` boundaries to find each command.
 */

export interface RunWarning {
  type: "unpinned_install" | "curl_pipe_sh";
  message: string;
}

export interface RunParseResult {
  packages: ParsedDependency[];
  warnings: RunWarning[];
}

const COMMAND_SEP_RE = /(?:&&|\|\||;)/;

interface DistroInstallParams {
  bin: string;                       // "apt-get" | "apk" | "dnf" | "yum"
  ecosystem: string;                 // Distro ecosystem string (e.g. "Debian:12")
  pinSeparator: "=" | "==" | "-";   // What goes between name and version
  versionInName: boolean;            // True for apt-get's `name=version` syntax
}

/**
 * Parse a `RUN` body assuming the host distro family. The caller supplies
 * the distro ecosystem (e.g. "Debian:12") so we can attach versions to the
 * right matcher.
 */
export function parseRun(
  body: string,
  distroEcosystem: string | null,
  family: "debian" | "alpine" | "rpm" | null,
): RunParseResult {
  const packages: ParsedDependency[] = [];
  const warnings: RunWarning[] = [];

  for (const cmd of splitCommands(body)) {
    const trimmed = cmd.trim();
    if (!trimmed) continue;

    // curl|sh / wget|sh detection.
    if (/\b(curl|wget)\b[^\n]*\|\s*(sh|bash)\b/.test(trimmed)) {
      warnings.push({
        type: "curl_pipe_sh",
        message: `Piping ${trimmed.match(/\b(curl|wget)\b/)![1]} into a shell skips integrity checks.`,
      });
    }

    if (family === "debian" && distroEcosystem) {
      handleDistroInstall(trimmed, distroEcosystem, "apt-get|apt", "install", "=", true, packages, warnings);
    }
    if (family === "alpine" && distroEcosystem) {
      handleDistroInstall(trimmed, distroEcosystem, "apk", "add", "=", true, packages, warnings);
    }
    if (family === "rpm" && distroEcosystem) {
      handleDistroInstall(trimmed, distroEcosystem, "dnf|yum|microdnf", "install", "-", false, packages, warnings);
    }

    handleLanguageInstall(trimmed, packages, warnings);
  }

  return { packages, warnings };
}

function splitCommands(body: string): string[] {
  return body.split(COMMAND_SEP_RE);
}

function handleDistroInstall(
  cmd: string,
  ecosystem: string,
  binPattern: string,
  verb: string,
  pinSep: "=" | "==" | "-",
  versionInName: boolean,
  packages: ParsedDependency[],
  warnings: RunWarning[],
): void {
  const re = new RegExp(`\\b(?:${binPattern})\\s+(?:[a-z-]+\\s+)*${verb}\\s+(.*)`, "i");
  const m = re.exec(cmd);
  if (!m) return;

  const argsRaw = m[1]!.replace(/[\s\\]+/g, " ").trim();
  // Drop trailing `-y`, `--no-install-recommends`, etc; keep package tokens.
  const tokens = argsRaw
    .split(/\s+/)
    .filter((t) => t.length > 0 && !t.startsWith("-"));

  for (const token of tokens) {
    if (versionInName) {
      // `name=version` (apt-get / apk) or `name==version` (some).
      const sepIdx = token.indexOf("=");
      if (sepIdx > 0) {
        const name = token.slice(0, sepIdx);
        const version = token.slice(sepIdx + 1).replace(/^=/, "");
        if (name && version) {
          packages.push({ ecosystem, name, version });
          continue;
        }
      }
      warnings.push({
        type: "unpinned_install",
        message: `Unpinned ${ecosystem} package: ${token}`,
      });
    } else {
      // RPM-style `name-version-release.arch`. Hard to split heuristically;
      // we conservatively treat as unpinned and warn unless the user wrote
      // `name = version` with explicit `=`.
      const eqIdx = token.indexOf("=");
      if (eqIdx > 0) {
        packages.push({
          ecosystem,
          name: token.slice(0, eqIdx),
          version: token.slice(eqIdx + 1),
        });
        continue;
      }
      warnings.push({
        type: "unpinned_install",
        message: `Unpinned ${ecosystem} package: ${token}`,
      });
    }
    // Suppress unused-pin-sep warning.
    void pinSep;
  }
}

function handleLanguageInstall(
  cmd: string,
  packages: ParsedDependency[],
  warnings: RunWarning[],
): void {
  // pip install foo==1.2.3 bar
  const pipMatch = /\bpip3?\s+install\b\s+(.*)/i.exec(cmd);
  if (pipMatch) {
    extractPipPackages(pipMatch[1]!, packages, warnings);
  }

  // npm install -g pkg@1.2.3
  const npmMatch = /\bnpm\s+(?:install|i)\b\s+(.*)/i.exec(cmd);
  if (npmMatch) {
    extractNpmPackages(npmMatch[1]!, packages, warnings);
  }

  // gem install foo -v 1.0
  const gemMatch = /\bgem\s+install\b\s+(.*)/i.exec(cmd);
  if (gemMatch) {
    extractGemPackages(gemMatch[1]!, packages, warnings);
  }
}

function extractPipPackages(args: string, packages: ParsedDependency[], warnings: RunWarning[]): void {
  const tokens = args
    .split(/\s+/)
    .filter((t) => t && !t.startsWith("-"));
  for (const token of tokens) {
    const noExtras = token.replace(/\[[^\]]*\]/, "");
    const m = /^([A-Za-z0-9._-]+)==([^\s]+)$/.exec(noExtras);
    if (m) {
      packages.push({ ecosystem: "PyPI", name: m[1]!, version: m[2]! });
    } else if (/^[A-Za-z0-9._-]+/.test(noExtras)) {
      warnings.push({
        type: "unpinned_install",
        message: `Unpinned PyPI package: ${token}`,
      });
    }
  }
}

function extractNpmPackages(args: string, packages: ParsedDependency[], warnings: RunWarning[]): void {
  const tokens = args
    .split(/\s+/)
    .filter((t) => t && !t.startsWith("-"));
  for (const token of tokens) {
    if (token === "install" || token === "i") continue;
    // Scoped package "@scope/name@1.0.0" or plain "name@1.0.0".
    const at = token.startsWith("@") ? token.indexOf("@", 1) : token.indexOf("@");
    if (at > 0) {
      const name = token.slice(0, at);
      const version = token.slice(at + 1);
      if (name && version && !version.includes("/")) {
        packages.push({ ecosystem: "npm", name, version });
        continue;
      }
    }
    warnings.push({
      type: "unpinned_install",
      message: `Unpinned npm package: ${token}`,
    });
  }
}

function extractGemPackages(args: string, packages: ParsedDependency[], warnings: RunWarning[]): void {
  // `gem install rails -v 6.1.0`  or  `gem install rails:6.1.0`
  const tokens = args.split(/\s+/);
  let lastName: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === "-v" || t === "--version") {
      const v = tokens[++i];
      if (lastName && v) {
        packages.push({ ecosystem: "RubyGems", name: lastName, version: v });
        lastName = null;
      }
      continue;
    }
    if (t.startsWith("-")) continue;
    if (t.includes(":")) {
      const [name, version] = t.split(":");
      if (name && version) {
        packages.push({ ecosystem: "RubyGems", name, version });
        continue;
      }
    }
    if (lastName) {
      // Previous name had no version — emit warning.
      warnings.push({
        type: "unpinned_install",
        message: `Unpinned RubyGems package: ${lastName}`,
      });
    }
    lastName = t;
  }
  if (lastName) {
    warnings.push({
      type: "unpinned_install",
      message: `Unpinned RubyGems package: ${lastName}`,
    });
  }
}
