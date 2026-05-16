import type { AffectedRange } from "@refuse/shared";
import type { VersionMatcher } from "./types";

/**
 * RPM version comparison — port of rpmvercmp from rpm/lib/rpmvercmp.c, plus EVR
 * (epoch:version-release) handling.
 *
 * Compared distros: Rocky Linux, Red Hat, AlmaLinux.
 *
 * Special characters:
 * - `~` ranks BELOW everything (pre-release marker, e.g. `1.0~rc1` < `1.0`)
 * - `^` is a post-release marker that ranks just after the same string would
 *   without `^`; semantics follow the cited C source.
 *
 * Source of truth: rpm/lib/rpmvercmp.c
 */

const ALNUM_RE = /[A-Za-z0-9]/;
const DIGIT_RE = /[0-9]/;
const ALPHA_RE = /[A-Za-z]/;

function isAlnum(c: string): boolean {
  return ALNUM_RE.test(c);
}
function isDigit(c: string): boolean {
  return DIGIT_RE.test(c);
}
function isAlpha(c: string): boolean {
  return ALPHA_RE.test(c);
}

/** Core rpmvercmp: returns -1, 0, or 1 comparing a single version string. */
export function rpmvercmp(a: string, b: string): number {
  let i = 0;
  let j = 0;

  while (i < a.length || j < b.length) {
    // Skip non-alnum, non-tilde, non-caret separators.
    while (i < a.length && !isAlnum(a[i]!) && a[i] !== "~" && a[i] !== "^") i++;
    while (j < b.length && !isAlnum(b[j]!) && b[j] !== "~" && b[j] !== "^") j++;

    // Tilde is less than anything (including empty).
    if (a[i] === "~" || b[j] === "~") {
      if (a[i] !== "~") return 1;
      if (b[j] !== "~") return -1;
      i++; j++; continue;
    }

    // Caret: empty string < ^; alnum > ^.
    if (a[i] === "^" || b[j] === "^") {
      if (i === a.length) return -1; // empty < ^
      if (j === b.length) return 1;
      if (a[i] !== "^") return 1; // alnum > ^
      if (b[j] !== "^") return -1;
      i++; j++; continue;
    }

    if (i >= a.length || j >= b.length) break;

    const startA = i;
    const startB = j;
    let isNum = false;

    if (isDigit(a[i]!)) {
      while (i < a.length && isDigit(a[i]!)) i++;
      while (j < b.length && isDigit(b[j]!)) j++;
      isNum = true;
    } else if (isAlpha(a[i]!)) {
      while (i < a.length && isAlpha(a[i]!)) i++;
      while (j < b.length && isAlpha(b[j]!)) j++;
      isNum = false;
    }

    // Run-type mismatch: if a's run is empty (different type than b started with), b wins.
    if (i === startA) return -1;
    if (j === startB) return 1;

    let segA = a.slice(startA, i);
    let segB = b.slice(startB, j);

    if (isNum) {
      segA = segA.replace(/^0+/, "");
      segB = segB.replace(/^0+/, "");
      if (segA.length !== segB.length) {
        return segA.length < segB.length ? -1 : 1;
      }
    }

    if (segA !== segB) return segA < segB ? -1 : 1;
  }

  if (i >= a.length && j >= b.length) return 0;
  if (i >= a.length) return -1;
  return 1;
}

interface EVR {
  epoch: number;
  version: string;
  release: string;
}

function parseEvr(raw: string): EVR | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let epoch = 0;
  let rest = trimmed;
  const colonIdx = rest.indexOf(":");
  if (colonIdx !== -1 && /^[0-9]+$/.test(rest.slice(0, colonIdx))) {
    epoch = Number(rest.slice(0, colonIdx));
    rest = rest.slice(colonIdx + 1);
  }

  const dashIdx = rest.lastIndexOf("-");
  const version = dashIdx === -1 ? rest : rest.slice(0, dashIdx);
  const release = dashIdx === -1 ? "" : rest.slice(dashIdx + 1);

  if (!version) return null;
  return { epoch, version, release };
}

function compareEvr(a: EVR, b: EVR): number {
  if (a.epoch !== b.epoch) return a.epoch < b.epoch ? -1 : 1;
  const v = rpmvercmp(a.version, b.version);
  if (v !== 0) return v;
  return rpmvercmp(a.release, b.release);
}

function compare(a: string, b: string): number {
  const pa = parseEvr(a);
  const pb = parseEvr(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  return compareEvr(pa, pb);
}

function isValid(v: string): boolean {
  return parseEvr(v) !== null;
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

export const rpmMatcher: VersionMatcher = {
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
    return false;
  },
};
