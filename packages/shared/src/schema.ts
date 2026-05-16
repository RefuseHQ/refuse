import { z } from "zod";
import { LicenseCategory } from "./license";

/* ─────────────── Severity ─────────────── */

export const SeverityLabel = z.enum(["critical", "high", "medium", "low", "unknown"]);
export type SeverityLabel = z.infer<typeof SeverityLabel>;

export function scoreToLabel(score: number | null | undefined): SeverityLabel {
  if (score == null || Number.isNaN(score)) return "unknown";
  if (score >= 9.0) return "critical";
  if (score >= 7.0) return "high";
  if (score >= 4.0) return "medium";
  return "low";
}

/* ─────────────── Range / advisory shapes ─────────────── */

export const AffectedRange = z.object({
  introduced: z.string().nullable().optional(),
  fixed: z.string().nullable().optional(),
  last_affected: z.string().nullable().optional(),
});
export type AffectedRange = z.infer<typeof AffectedRange>;

export const CardAdvisory = z.object({
  refuse_id: z.string(),
  primary_id: z.string(),
  aliases: z.array(z.string()),
  summary: z.string(),
  severity_score: z.number().nullable(),
  severity_label: SeverityLabel,
  ranges: z.array(AffectedRange),
  fix_versions: z.array(z.string()),
  references: z.array(z.string()),
  // Enrichment from CISA KEV catalog — set when any of `aliases` matches a
  // CVE on the KEV list.
  kev_listed: z.boolean().optional(),
  kev_added_at: z.string().nullable().optional(),
  ransomware_use: z.boolean().optional(),
  // EPSS exploit-probability — 0..1. Highest matching CVE alias wins.
  epss_score: z.number().nullable().optional(),
  epss_percentile: z.number().nullable().optional(),
  // Set on advisories whose primary id or aliases include an OSV `MAL-` entry,
  // or whose source flagged the package as malicious. Distinct from CVE — most
  // malicious packages never get a CVE, so callers gate on this separately.
  is_malicious: z.boolean().optional(),
});
export type CardAdvisory = z.infer<typeof CardAdvisory>;

/** SPDX license + risk bucket. Stored at the package level on the card. */
export const LicenseInfo = z.object({
  spdx: z.string().nullable(),
  category: LicenseCategory,
});
export type LicenseInfo = z.infer<typeof LicenseInfo>;

/** Pre-computed value stored in KV under `card:v1:{ecosystem}:{name}`. */
export const VulnCard = z.object({
  ecosystem: z.string(),
  name: z.string(),
  advisories: z.array(CardAdvisory),
  latest_stable: z.string().nullable(),
  latest_any: z.string().nullable(),
  updated_at: z.string(),
  // Package-level license bucket. Sourced from deps.dev's GetVersion for the
  // default version and applied to all rows under this package — license
  // changes between versions are rare enough that we tolerate the
  // approximation in v1. Absent for ecosystems deps.dev doesn't cover.
  license: LicenseInfo.optional(),
});
export type VulnCard = z.infer<typeof VulnCard>;

/* ─────────────── MCP tool I/O ─────────────── */

const FixType = z.enum(["minimum_safe", "latest_stable", "latest"]);
export type FixType = z.infer<typeof FixType>;

const Freshness = z.enum(["fresh", "stale"]);
export type Freshness = z.infer<typeof Freshness>;

const SuggestedFix = z.object({
  version: z.string(),
  type: FixType,
  breaking_change: z.boolean(),
  rationale: z.string(),
});
export type SuggestedFix = z.infer<typeof SuggestedFix>;

const VulnerabilityRef = z.object({
  refuse_id: z.string(),
  cve: z.string().nullable(),
  ghsa: z.string().nullable(),
  severity_score: z.number(),
  severity_label: SeverityLabel,
  summary: z.string(),
  references: z.array(z.string()),
  // CISA KEV catalog enrichment.
  kev_listed: z.boolean().optional(),
  kev_added_at: z.string().nullable().optional(),
  ransomware_use: z.boolean().optional(),
  // EPSS exploit-probability enrichment (0..1).
  epss_score: z.number().nullable().optional(),
  epss_percentile: z.number().nullable().optional(),
  // Set when the underlying advisory is an OSV `MAL-` entry or otherwise
  // flagged as malicious. Distinct signal from CVE severity.
  is_malicious: z.boolean().optional(),
});
export type VulnerabilityRef = z.infer<typeof VulnerabilityRef>;

/* check_package */
export const CheckPackageInput = z.object({
  ecosystem: z.string(),
  name: z.string(),
  version: z.string(),
});
export type CheckPackageInput = z.infer<typeof CheckPackageInput>;

export const CheckPackageOutput = z.object({
  vulnerable: z.boolean(),
  package: z.string(),
  version: z.string(),
  vulnerabilities: z.array(VulnerabilityRef),
  suggested_fixes: z.array(SuggestedFix),
  freshness: Freshness,
  // Package-level license. Absent when we have no card or deps.dev doesn't
  // cover the ecosystem. The agent should treat absence as "unknown" rather
  // than "no license."
  license: LicenseInfo.optional(),
  // True iff any matching advisory has is_malicious=true. Surfaced as a
  // top-level flag because the right action is "do not install," which differs
  // from the CVE upgrade path.
  malicious: z.boolean().optional(),
  error: z.string().optional(),
});
export type CheckPackageOutput = z.infer<typeof CheckPackageOutput>;

/* suggest_safe_version */
export const SuggestSafeVersionInput = z.object({
  ecosystem: z.string(),
  name: z.string(),
  current_version: z.string().optional(),
});
export type SuggestSafeVersionInput = z.infer<typeof SuggestSafeVersionInput>;

export const SuggestSafeVersionOutput = z.object({
  package: z.string(),
  current_version: z.string().nullable(),
  suggestions: z.array(SuggestedFix),
});
export type SuggestSafeVersionOutput = z.infer<typeof SuggestSafeVersionOutput>;

/* batch_check */
const Summary = z.object({
  /** Number of (package, version) pairs we actually checked. Drives billing. */
  total: z.number(),
  /** How many of those were vulnerable. */
  vulnerable: z.number(),
  /** How many had at least one matching advisory flagged as malicious. */
  malicious: z.number().optional(),
  /**
   * Packages we extracted from the input but could not check — usually
   * because no version was pinned. Surface count so the response is honest
   * about coverage, but they don't contribute to the billed scan count.
   */
  unscannable: z.number().optional(),
  by_severity: z.object({
    critical: z.number(),
    high: z.number(),
    medium: z.number(),
    low: z.number(),
  }),
  /** Counts of license categories across all scanned packages. Omitted when
   *  no license data is available for any package in the batch. */
  by_license: z
    .object({
      permissive: z.number(),
      weak_copyleft: z.number(),
      strong_copyleft: z.number(),
      source_available_restricted: z.number(),
      public_domain: z.number(),
      unknown: z.number(),
    })
    .optional(),
});
export type Summary = z.infer<typeof Summary>;

export const BatchCheckInput = z.object({
  packages: z.array(CheckPackageInput),
});
export type BatchCheckInput = z.infer<typeof BatchCheckInput>;

export const BatchCheckOutput = z.object({
  results: z.array(CheckPackageOutput),
  summary: Summary,
  truncated: z.boolean().optional(),
});
export type BatchCheckOutput = z.infer<typeof BatchCheckOutput>;

/* check_lockfile */
export const CheckLockfileInput = z.object({
  filename: z.string(),
  content: z.string(),
});
export type CheckLockfileInput = z.infer<typeof CheckLockfileInput>;

export const CheckLockfileOutput = BatchCheckOutput;
export type CheckLockfileOutput = z.infer<typeof CheckLockfileOutput>;

/* check_dockerfile */
const DockerfileWarningType = z.enum([
  "unpinned_install",
  "curl_pipe_sh",
  "unknown_base_image",
  "rolling_tag",
]);

const Warning = z.object({
  type: z.string(),
  line: z.number(),
  message: z.string(),
});

const DockerfileWarning = Warning.extend({
  type: DockerfileWarningType,
});
export type DockerfileWarning = z.infer<typeof DockerfileWarning>;

export const CheckDockerfileInput = z.object({
  content: z.string(),
  detected_distro: z.string().optional(),
});
export type CheckDockerfileInput = z.infer<typeof CheckDockerfileInput>;

export const CheckDockerfileOutput = z.object({
  detected_base_image: z.string().nullable(),
  detected_distro: z.string().nullable(),
  results: z.array(CheckPackageOutput),
  warnings: z.array(DockerfileWarning),
  summary: Summary,
});
export type CheckDockerfileOutput = z.infer<typeof CheckDockerfileOutput>;

/* check_workflow */
const WorkflowWarningType = z.enum(["unpinned_action", "rolling_ref", "uses_master_or_main"]);

const WorkflowWarning = Warning.extend({
  type: WorkflowWarningType,
});
export type WorkflowWarning = z.infer<typeof WorkflowWarning>;

export const CheckWorkflowInput = z.object({
  content: z.string(),
});
export type CheckWorkflowInput = z.infer<typeof CheckWorkflowInput>;

export const CheckWorkflowOutput = z.object({
  results: z.array(CheckPackageOutput),
  warnings: z.array(WorkflowWarning),
  summary: Summary,
});
export type CheckWorkflowOutput = z.infer<typeof CheckWorkflowOutput>;
