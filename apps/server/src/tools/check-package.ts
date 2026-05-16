import {
  type CheckPackageInput,
  type CheckPackageOutput,
  type SuggestedFix,
  type VulnerabilityRef,
  type CardAdvisory,
  type AffectedRange,
  type VulnCard,
  normalizeEcosystem,
  canonicalizePackageName,
} from "@refuse/shared";
import { getMatcher, type VersionMatcher } from "@refuse/versions";
import { readCard, type CardReader } from "../cards";

/**
 * Implementation of the `check_package` MCP tool. Pure-ish — takes a card reader
 * namespace and an input object, returns the output. The MCP wiring is
 * separate (see ../mcp.ts).
 *
 * Behavior on errors (spec §10.5, §10.8): fail OPEN. On unsupported ecosystems
 * or card-store outages, return `vulnerable: false` with `freshness: "stale"` and an
 * `error` field. The agent decides whether to proceed.
 */

export async function checkPackage(
  cards: CardReader,
  input: CheckPackageInput,
): Promise<CheckPackageOutput> {
  const baseError = (msg: string): CheckPackageOutput => ({
    vulnerable: false,
    package: input.name,
    version: input.version,
    vulnerabilities: [],
    suggested_fixes: [],
    freshness: "stale",
    error: msg,
  });

  const ecosystem = normalizeEcosystem(input.ecosystem);
  if (!ecosystem) return baseError(`Unknown ecosystem: ${input.ecosystem}`);

  const name = canonicalizePackageName(ecosystem, input.name);

  let matcher: VersionMatcher;
  try {
    matcher = getMatcher(ecosystem);
  } catch (e) {
    return baseError((e as Error).message);
  }

  let card: VulnCard | null;
  try {
    card = await readCard(cards, ecosystem, name);
  } catch (e) {
    return baseError(`Card store unavailable: ${(e as Error).message}`);
  }

  if (card === null) {
    return {
      vulnerable: false,
      package: name,
      version: input.version,
      vulnerabilities: [],
      suggested_fixes: [],
      freshness: "fresh",
    };
  }

  const matching = card.advisories.filter((adv) =>
    matcher.isAffected(input.version, adv.ranges),
  );

  if (matching.length === 0) {
    return {
      vulnerable: false,
      package: name,
      version: input.version,
      vulnerabilities: [],
      suggested_fixes: [],
      freshness: "fresh",
      ...(card.license ? { license: card.license } : {}),
    };
  }

  const vulnerabilities: VulnerabilityRef[] = matching.map(toVulnerabilityRef);
  const suggested_fixes = computeSuggestedFixes(matcher, input.version, matching, card);
  const malicious = matching.some((a) => a.is_malicious === true);

  return {
    vulnerable: true,
    package: name,
    version: input.version,
    vulnerabilities,
    suggested_fixes,
    freshness: "fresh",
    ...(card.license ? { license: card.license } : {}),
    ...(malicious ? { malicious: true } : {}),
  };
}

function toVulnerabilityRef(adv: CardAdvisory): VulnerabilityRef {
  const cve = adv.aliases.find((a) => /^CVE-/i.test(a)) ?? null;
  const ghsa = adv.aliases.find((a) => /^GHSA-/i.test(a)) ?? null;
  return {
    refuse_id: adv.refuse_id,
    cve,
    ghsa,
    severity_score: adv.severity_score ?? 0,
    severity_label: adv.severity_label,
    summary: adv.summary,
    references: adv.references,
    ...(adv.is_malicious ? { is_malicious: true } : {}),
    ...(adv.kev_listed
      ? {
          kev_listed: true,
          kev_added_at: adv.kev_added_at ?? null,
          ...(adv.ransomware_use ? { ransomware_use: true } : {}),
        }
      : {}),
    ...(adv.epss_score !== undefined && adv.epss_score !== null
      ? {
          epss_score: adv.epss_score,
          epss_percentile: adv.epss_percentile ?? null,
        }
      : {}),
  };
}

/**
 * Build the suggested-fixes list:
 *  - minimum_safe: smallest version >= current that escapes ALL matching ranges
 *  - latest_stable: the package's latest non-prerelease version (from card)
 *  - latest:        the package's latest version of any kind (from card)
 *
 * Each entry is annotated with `breaking_change` and a human-readable rationale.
 * Duplicates are de-duplicated by version string.
 */
function computeSuggestedFixes(
  matcher: VersionMatcher,
  current: string,
  matchingAdvisories: CardAdvisory[],
  card: VulnCard,
): SuggestedFix[] {
  const allRanges: AffectedRange[] = matchingAdvisories.flatMap((a) => a.ranges);
  const candidatePool = collectCandidatePool(card, matchingAdvisories);

  const fixes: SuggestedFix[] = [];
  const seen = new Set<string>();
  const push = (fix: SuggestedFix): void => {
    if (seen.has(fix.version)) return;
    seen.add(fix.version);
    fixes.push(fix);
  };

  const minSafe = matcher.minimumSafeUpgrade(current, allRanges, candidatePool);
  if (minSafe) {
    push({
      version: minSafe,
      type: "minimum_safe",
      breaking_change: matcher.isBreakingChange(current, minSafe),
      rationale: `Smallest version not affected by ${matchingAdvisories.length} known advisor${matchingAdvisories.length === 1 ? "y" : "ies"}.`,
    });
  }

  if (card.latest_stable && !matcher.isAffected(card.latest_stable, allRanges)) {
    push({
      version: card.latest_stable,
      type: "latest_stable",
      breaking_change: matcher.isBreakingChange(current, card.latest_stable),
      rationale: "Latest stable release.",
    });
  }

  if (
    card.latest_any &&
    card.latest_any !== card.latest_stable &&
    !matcher.isAffected(card.latest_any, allRanges)
  ) {
    push({
      version: card.latest_any,
      type: "latest",
      breaking_change: matcher.isBreakingChange(current, card.latest_any),
      rationale: "Latest release (may be a pre-release).",
    });
  }

  return fixes;
}

/**
 * Collect candidate versions for minimum-safe-upgrade calculation. We use:
 *   1. Every `fixed` version from advisory ranges (the canonical safe
 *      boundaries — usually the right answer).
 *   2. `latest_stable` and `latest_any` from the card (so we can suggest the
 *      newest version when no fix range is known).
 */
function collectCandidatePool(
  card: VulnCard,
  matchingAdvisories: CardAdvisory[],
): string[] {
  const set = new Set<string>();
  for (const adv of matchingAdvisories) {
    for (const v of adv.fix_versions) set.add(v);
  }
  if (card.latest_stable) set.add(card.latest_stable);
  if (card.latest_any) set.add(card.latest_any);
  return Array.from(set);
}
