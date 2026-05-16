import type { AffectedRange } from "@refuse/shared";
import type { VersionMatcher } from "./types";

/**
 * Maven version comparison — a simplified port of ComparableVersion from
 * org.apache.maven:maven-artifact. Covers the common cases that show up in
 * OSV advisories and real Maven coordinates:
 *
 * - `1.2.3` (numeric)
 * - `1.0-SNAPSHOT`, `1.0.0-rc1`, `1.0-alpha-3`, `2.0-beta9` (pre-release qualifiers)
 * - `1.2.3.RELEASE` / `.GA` / `.FINAL` (Spring-style "null" qualifiers stripped)
 * - Trailing zeros equivalent (`1.2.0` == `1.2`)
 *
 * What's NOT modeled: nested sub-lists from multiple hyphens (e.g. `1-1-1`
 * which Maven would parse as `[1, [1, [1]]]`). For OSV range matching against
 * real CVEs (log4j, struts, spring) the flat tokenization is sufficient.
 *
 * Source of truth: maven/maven-artifact/src/main/java/org/apache/maven/artifact/versioning/ComparableVersion.java
 */

type Item = { kind: "int"; value: number } | { kind: "str"; value: string };

const KNOWN_QUALIFIERS = ["alpha", "beta", "milestone", "rc", "snapshot", "", "sp"];
const NULL_QUALIFIERS = new Set(["", "ga", "final", "release"]);
const QUALIFIER_SHORTCUTS: Record<string, string> = { a: "alpha", b: "beta", m: "milestone", cr: "rc" };

function tokenize(rawIn: string): Item[] | null {
  if (!rawIn) return null;
  const raw = rawIn.trim().toLowerCase();
  if (!/^[0-9a-z.\-]+$/.test(raw)) return null;

  // Insert "-" at letter↔digit boundaries so `2.0-beta9` becomes `2.0-beta-9`.
  const expanded = raw
    .replace(/([0-9])([a-z])/g, "$1-$2")
    .replace(/([a-z])([0-9])/g, "$1-$2");

  const parts = expanded.split(/[.\-]/).filter((p) => p.length > 0);
  if (parts.length === 0) return null;

  const items: Item[] = parts.map((p): Item => {
    if (/^\d+$/.test(p)) return { kind: "int", value: Number(p) };
    const expanded = QUALIFIER_SHORTCUTS[p] ?? p;
    return { kind: "str", value: expanded };
  });

  // Strip trailing "null" items: int 0 or null-qualifier strings.
  while (items.length > 0) {
    const last = items[items.length - 1]!;
    if (last.kind === "int" && last.value === 0) {
      items.pop();
    } else if (last.kind === "str" && NULL_QUALIFIERS.has(last.value)) {
      items.pop();
    } else {
      break;
    }
  }

  return items;
}

function qualifierRank(q: string): number {
  const i = KNOWN_QUALIFIERS.indexOf(q);
  // Unknown qualifiers rank ABOVE all known qualifiers (Maven semantics).
  return i === -1 ? KNOWN_QUALIFIERS.length : i;
}

const RELEASE_INDEX = KNOWN_QUALIFIERS.indexOf(""); // 5

/**
 * Compares two items in Maven's mixed-type model. The `aAbsent`/`bAbsent` flags
 * indicate "padded from end of the shorter list," which Maven treats as the
 * RELEASE qualifier — that's why `1.0-sp` (sp ranks above release) sorts above
 * `1.0`, while `1.0-alpha` (alpha ranks below release) sorts below.
 */
function compareItems(a: Item, b: Item, aAbsent: boolean, bAbsent: boolean): number {
  if (a.kind === "int" && b.kind === "int") {
    return a.value === b.value ? 0 : a.value < b.value ? -1 : 1;
  }
  if (a.kind === "str" && b.kind === "str") {
    const ra = qualifierRank(a.value);
    const rb = qualifierRank(b.value);
    if (ra !== rb) return ra < rb ? -1 : 1;
    if (a.value === b.value) return 0;
    return a.value < b.value ? -1 : 1;
  }
  // Mixed: exactly one is int, the other is str.
  if (a.kind === "int" && b.kind === "str") {
    if (bAbsent) return 1; // unreachable: absent items use the int placeholder
    const sRank = qualifierRank(b.value);
    if (aAbsent) return sRank === RELEASE_INDEX ? 0 : sRank < RELEASE_INDEX ? 1 : -1;
    return 1;
  }
  // a.kind === "str", b.kind === "int"
  if (a.kind === "str" && b.kind === "int") {
    if (aAbsent) return -1;
    const sRank = qualifierRank(a.value);
    if (bAbsent) return sRank === RELEASE_INDEX ? 0 : sRank < RELEASE_INDEX ? -1 : 1;
    return -1;
  }
  return 0; // unreachable
}

const ABSENT_PAD: Item = { kind: "int", value: 0 };

function compare(a: string, b: string): number {
  const ai = tokenize(a) ?? [];
  const bi = tokenize(b) ?? [];
  const n = Math.max(ai.length, bi.length);
  for (let i = 0; i < n; i++) {
    const aHas = i < ai.length;
    const bHas = i < bi.length;
    const x = aHas ? ai[i]! : ABSENT_PAD;
    const y = bHas ? bi[i]! : ABSENT_PAD;
    const c = compareItems(x, y, !aHas, !bHas);
    if (c !== 0) return c;
  }
  return 0;
}

function isValid(v: string): boolean {
  return tokenize(v) !== null;
}

function isAffectedByRange(version: string, range: AffectedRange): boolean {
  if (!isValid(version)) return false;

  const introducedRaw = range.introduced;
  const introduced =
    introducedRaw && introducedRaw !== "0" && isValid(introducedRaw)
      ? introducedRaw
      : null;
  const fixed = range.fixed && isValid(range.fixed) ? range.fixed : null;
  const lastAffected =
    range.last_affected && isValid(range.last_affected) ? range.last_affected : null;

  if (introduced && compare(version, introduced) < 0) return false;
  if (fixed && compare(version, fixed) >= 0) return false;
  if (lastAffected && compare(version, lastAffected) > 0) return false;

  return true;
}

function isAffected(version: string, ranges: AffectedRange[]): boolean {
  return ranges.some((r) => isAffectedByRange(version, r));
}

export const mavenMatcher: VersionMatcher = {
  isAffected,

  minimumSafeUpgrade(currentVersion, ranges, availableVersions) {
    const currentValid = isValid(currentVersion);
    const safe: string[] = [];
    for (const v of availableVersions) {
      if (!isValid(v)) continue;
      if (currentValid && compare(v, currentVersion) < 0) continue;
      if (isAffected(v, ranges)) continue;
      safe.push(v);
    }
    safe.sort(compare);
    return safe[0] ?? null;
  },

  isBreakingChange(from, to) {
    const a = tokenize(from);
    const b = tokenize(to);
    if (!a || !b) return false;
    const aMaj = a[0]?.kind === "int" ? a[0].value : null;
    const bMaj = b[0]?.kind === "int" ? b[0].value : null;
    if (aMaj === null || bMaj === null) return false;
    return aMaj !== bMaj;
  },
};
