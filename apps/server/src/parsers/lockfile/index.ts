import type { LockfileParser } from "./types";
import { parseRequirementsTxt } from "./requirements-txt";
import { parsePackageLockJson } from "./package-lock-json";
import { parseYarnLock } from "./yarn-lock";
import { parsePnpmLockYaml } from "./pnpm-lock-yaml";
import { parseCargoLock } from "./cargo-lock";
import { parseGemfileLock } from "./gemfile-lock";
import { parseGoSum } from "./go-sum";
import { parseComposerLock } from "./composer-lock";
import { parseMixLock } from "./mix-lock";
import { parsePubspecLock } from "./pubspec-lock";
import { parsePomXml } from "./pom-xml";
import { parseCsproj } from "./csproj";
import { parseBunLock } from "./bun-lock";

export type { ParsedDependency, LockfileParser } from "./types";

/**
 * Picks a parser based on the filename. Recognizes the concrete lockfile
 * names; for `*.csproj` we look at the extension.
 */
export function parserForFilename(filename: string): LockfileParser | null {
  const base = filename.split("/").pop()?.toLowerCase() ?? filename.toLowerCase();
  if (base === "requirements.txt") return parseRequirementsTxt;
  if (base === "package-lock.json") return parsePackageLockJson;
  if (base === "yarn.lock") return parseYarnLock;
  if (base === "pnpm-lock.yaml") return parsePnpmLockYaml;
  if (base === "bun.lock" || base === "bun.lockb") return parseBunLock;
  if (base === "cargo.lock") return parseCargoLock;
  if (base === "gemfile.lock") return parseGemfileLock;
  if (base === "go.sum") return parseGoSum;
  if (base === "composer.lock") return parseComposerLock;
  if (base === "mix.lock") return parseMixLock;
  if (base === "pubspec.lock") return parsePubspecLock;
  if (base === "pom.xml") return parsePomXml;
  if (base.endsWith(".csproj")) return parseCsproj;
  return null;
}
