import type { AffectedRange } from "@refuse/shared";
import type { VersionMatcher } from "./types";

/**
 * Alpine apk version comparison — simplified port of apk_version_compare from
 * apk-tools/src/version.c. Format:
 *
 *   [epoch:]version[_suffix...][-rN]
 *
 *   version = number(.number)*letter?
 *   suffix  = _<kind><number?>   where kind ∈ alpha|beta|pre|rc|cvs|svn|git|hg|p
 *
 * Pre-suffixes (alpha, beta, pre, rc, cvs, svn, git, hg) rank below release;
 * the post-suffix `_p` ranks above release.
 *
 * Source of truth: apk-tools/src/version.c
 */

const PRE_SUFFIXES = ["alpha", "beta", "pre", "rc", "cvs", "svn", "git", "hg"] as const;
const POST_SUFFIXES = ["p"] as const;

interface AlpineSuffix {
  kind: "pre" | "post";
  rank: number; // index within its kind list
  name: string;
  num: number;
}

interface AlpineVersion {
  epoch: number;
  segments: Array<{ num: number; letter: string }>;
  suffixes: AlpineSuffix[];
  revision: number;
}

function classifySuffix(name: string): { kind: "pre" | "post"; rank: number } | null {
  const preIdx = PRE_SUFFIXES.indexOf(name as (typeof PRE_SUFFIXES)[number]);
  if (preIdx !== -1) return { kind: "pre", rank: preIdx };
  const postIdx = POST_SUFFIXES.indexOf(name as (typeof POST_SUFFIXES)[number]);
  if (postIdx !== -1) return { kind: "post", rank: postIdx };
  return null;
}

function parse(rawIn: string): AlpineVersion | null {
  if (!rawIn) return null;
  let s = rawIn.trim();
  if (!s) return null;

  // Optional epoch.
  let epoch = 0;
  const epochMatch = /^([0-9]+):/.exec(s);
  if (epochMatch) {
    epoch = Number(epochMatch[1]);
    s = s.slice(epochMatch[0].length);
  }

  // Version body — digits, dots, optional trailing letter on each numeric segment.
  const segments: Array<{ num: number; letter: string }> = [];
  while (s.length > 0) {
    const m = /^([0-9]+)([a-z]?)(?:\.|$|[_-])/.exec(s) ?? /^([0-9]+)([a-z]?)/.exec(s);
    if (!m) break;
    segments.push({ num: Number(m[1]), letter: m[2] ?? "" });
    s = s.slice(m[1]!.length + (m[2]?.length ?? 0));
    if (s.startsWith(".")) {
      s = s.slice(1);
      continue;
    }
    break;
  }
  if (segments.length === 0) return null;

  // Suffixes: zero or more `_<name><number?>`.
  const suffixes: AlpineSuffix[] = [];
  while (s.startsWith("_")) {
    const m = /^_([a-z]+)([0-9]*)/.exec(s);
    if (!m) return null;
    const name = m[1]!;
    const numStr = m[2] ?? "";
    const cls = classifySuffix(name);
    if (!cls) return null;
    suffixes.push({ kind: cls.kind, rank: cls.rank, name, num: numStr ? Number(numStr) : 0 });
    s = s.slice(m[0].length);
  }

  // Revision: `-rN`.
  let revision = 0;
  const revMatch = /^-r([0-9]+)$/.exec(s);
  if (revMatch) {
    revision = Number(revMatch[1]);
    s = "";
  }

  if (s.length > 0) return null;
  return { epoch, segments, suffixes, revision };
}

function compareSegments(
  a: AlpineVersion["segments"],
  b: AlpineVersion["segments"],
): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.num !== y.num) return x.num < y.num ? -1 : 1;
    if (x.letter !== y.letter) return x.letter < y.letter ? -1 : 1;
  }
  // Longer (more segments) wins unless trailing segments are 0 with no letter.
  if (a.length !== b.length) {
    const longer = a.length > b.length ? a : b;
    const sign = a.length > b.length ? 1 : -1;
    for (let i = n; i < longer.length; i++) {
      const seg = longer[i]!;
      if (seg.num !== 0 || seg.letter !== "") return sign;
    }
    return 0; // trailing zero-segments equivalent
  }
  return 0;
}

function compareSuffixes(a: AlpineSuffix[], b: AlpineSuffix[]): number {
  // Each suffix list compared positionally. Treat empty list as RELEASE.
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i];
    const y = b[i];
    if (!x && !y) return 0;
    if (!x) return y!.kind === "pre" ? 1 : -1;   // missing acts as RELEASE
    if (!y) return x.kind === "pre" ? -1 : 1;
    if (x.kind !== y.kind) return x.kind === "pre" ? -1 : 1;
    if (x.rank !== y.rank) return x.rank < y.rank ? -1 : 1;
    if (x.num !== y.num) return x.num < y.num ? -1 : 1;
  }
  return 0;
}

function compareParsed(a: AlpineVersion, b: AlpineVersion): number {
  if (a.epoch !== b.epoch) return a.epoch < b.epoch ? -1 : 1;
  const c = compareSegments(a.segments, b.segments);
  if (c !== 0) return c;
  const s = compareSuffixes(a.suffixes, b.suffixes);
  if (s !== 0) return s;
  if (a.revision !== b.revision) return a.revision < b.revision ? -1 : 1;
  return 0;
}

function compare(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  return compareParsed(pa, pb);
}

function isValid(v: string): boolean {
  return parse(v) !== null;
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

export const apkMatcher: VersionMatcher = {
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

  isBreakingChange(_from, _to) {
    // Distro packages don't expose semver-style major boundaries reliably.
    return false;
  },
};
