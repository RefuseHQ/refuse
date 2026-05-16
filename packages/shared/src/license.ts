import { z } from "zod";

/**
 * License risk classification. We don't try to litigate copyright — we group
 * SPDX expressions into coarse buckets that map to the policies most engineering
 * orgs actually care about (permissive, copyleft, source-available-but-restricted).
 *
 * Source data: SPDX expressions as returned by deps.dev's GetVersion endpoint.
 * Common shapes seen in the wild:
 *   "MIT"
 *   "Apache-2.0"
 *   "MIT OR Apache-2.0"          ← composite, take the most permissive
 *   "GPL-3.0-only AND MIT"       ← composite, take the most restrictive
 *   "(MIT OR Apache-2.0) AND BSD-3-Clause"
 *   "SEE LICENSE IN file"        ← unknown
 *   ""                           ← unknown
 */

export const LicenseCategory = z.enum([
  "permissive",
  "weak_copyleft",
  "strong_copyleft",
  "source_available_restricted",
  "public_domain",
  "unknown",
]);
export type LicenseCategory = z.infer<typeof LicenseCategory>;

/* ─────────────── SPDX → category lookup ─────────────── */

const PERMISSIVE = new Set([
  "MIT",
  "MIT-0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "BSD-3-Clause-Clear",
  "Apache-2.0",
  "Apache-1.1",
  "ISC",
  "0BSD",
  "Zlib",
  "BSL-1.0",
  "PostgreSQL",
  "Python-2.0",
  "Python-2.0.1",
  "PSF-2.0",
  "X11",
  "AFL-3.0",
  "ECL-2.0",
  "WTFPL",
]);

const WEAK_COPYLEFT = new Set([
  "LGPL-2.0",
  "LGPL-2.0-only",
  "LGPL-2.0-or-later",
  "LGPL-2.1",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MPL-1.1",
  "MPL-2.0",
  "EPL-1.0",
  "EPL-2.0",
  "CDDL-1.0",
  "CDDL-1.1",
  "Artistic-2.0",
  "OSL-3.0",
]);

const STRONG_COPYLEFT = new Set([
  "GPL-2.0",
  "GPL-2.0-only",
  "GPL-2.0-or-later",
  "GPL-3.0",
  "GPL-3.0-only",
  "GPL-3.0-or-later",
  "AGPL-3.0",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "EUPL-1.1",
  "EUPL-1.2",
]);

// Source-available but with field-of-use, commercial, or service-provider
// restrictions that fail most "is this OSI-approved?" tests. These usually
// require legal review before use.
const SOURCE_AVAILABLE_RESTRICTED = new Set([
  "SSPL-1.0",
  "BUSL-1.1",
  "Elastic-2.0",
  "Commons-Clause",
  "FSL-1.0",
  "FSL-1.1",
  "Confluent-Community-1.0",
  "RSAL-1.0",
  "RSAL-2.0",
  "PolyForm-Noncommercial-1.0.0",
  "PolyForm-Shield-1.0.0",
  "PolyForm-Strict-1.0.0",
]);

const PUBLIC_DOMAIN = new Set([
  "CC0-1.0",
  "Unlicense",
  "PDDL-1.0",
]);

const UNKNOWN_MARKERS = new Set([
  "",
  "UNLICENSED",
  "UNKNOWN",
  "NOASSERTION",
  "SEE LICENSE IN FILE",
  "SEE-LICENSE-IN-FILE",
  "LICENSEREF",
]);

/** Risk ordering — higher number = higher risk for typical permissive policies. */
const RISK_RANK: Record<LicenseCategory, number> = {
  public_domain: 0,
  permissive: 1,
  weak_copyleft: 2,
  unknown: 3,
  strong_copyleft: 4,
  source_available_restricted: 5,
};

/* ─────────────── Classifier ─────────────── */

export interface LicenseClassification {
  spdx: string | null;          // canonical SPDX expression (or null if unparseable)
  category: LicenseCategory;
}

function classifySingle(token: string): LicenseCategory {
  const t = token.trim().replace(/^\(|\)$/g, "");
  if (t === "") return "unknown";
  const upper = t.toUpperCase();
  if (UNKNOWN_MARKERS.has(upper)) return "unknown";
  if (upper.startsWith("LICENSEREF-")) return "unknown";
  // Strip "+" suffix used by SPDX for "or-later" semantics — the base id still
  // carries the category.
  const stripped = t.replace(/\+$/, "");
  if (PERMISSIVE.has(stripped)) return "permissive";
  if (WEAK_COPYLEFT.has(stripped)) return "weak_copyleft";
  if (STRONG_COPYLEFT.has(stripped)) return "strong_copyleft";
  if (SOURCE_AVAILABLE_RESTRICTED.has(stripped)) return "source_available_restricted";
  if (PUBLIC_DOMAIN.has(stripped)) return "public_domain";
  return "unknown";
}

/**
 * Parse a single SPDX expression and return the worst-case category. We only
 * implement the subset of SPDX needed in practice:
 *   - "A"                          → category(A)
 *   - "A OR B"                     → least-restrictive of {A, B}
 *   - "A AND B"                    → most-restrictive of {A, B}
 *   - "(A OR B) AND C"             → recurse on parens
 *
 * Bias on conflict: for OR-expressions we pick the lowest risk (the consumer
 * may pick that branch); for AND-expressions we pick the highest risk
 * (consumer is bound by both).
 */
function evaluateExpression(expr: string): LicenseCategory {
  const trimmed = expr.trim();
  if (trimmed === "") return "unknown";

  // Resolve parenthesized sub-expressions first.
  let s = trimmed;
  while (s.includes("(")) {
    const open = s.lastIndexOf("(");
    const close = s.indexOf(")", open);
    if (close === -1) break;          // mismatched parens — treat as opaque
    const inner = s.slice(open + 1, close);
    const innerCat = evaluateExpression(inner);
    s = s.slice(0, open) + ` __${innerCat}__ ` + s.slice(close + 1);
  }

  // Split on top-level OR / AND. We preserve precedence by handling AND first.
  // Replace placeholder tokens with their category at lookup time.
  const lookupToken = (tok: string): LicenseCategory => {
    const m = tok.match(/^__([a-z_]+)__$/);
    if (m) return m[1] as LicenseCategory;
    return classifySingle(tok);
  };

  const orParts = s.split(/\s+OR\s+/i);
  const andCategoriesPerOr = orParts.map((part) => {
    const andParts = part.split(/\s+AND\s+/i);
    const cats = andParts.map((p) => lookupToken(p.trim())).filter(Boolean);
    if (cats.length === 0) return "unknown" as LicenseCategory;
    // AND: take the most restrictive.
    return cats.reduce((acc, c) => (RISK_RANK[c] > RISK_RANK[acc] ? c : acc));
  });
  if (andCategoriesPerOr.length === 0) return "unknown";
  // OR: take the least restrictive.
  return andCategoriesPerOr.reduce((acc, c) =>
    RISK_RANK[c] < RISK_RANK[acc] ? c : acc,
  );
}

/**
 * Classify a list of SPDX expressions (e.g. as returned by deps.dev — most
 * packages declare exactly one). When multiple are present we treat them as
 * AND (consumer is bound by all) and report the most restrictive.
 */
export function classifyLicense(licenses: string[] | null | undefined): LicenseClassification {
  if (!licenses || licenses.length === 0) {
    return { spdx: null, category: "unknown" };
  }
  // Filter out obvious empties.
  const cleaned = licenses
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (cleaned.length === 0) return { spdx: null, category: "unknown" };

  const cats = cleaned.map(evaluateExpression);
  // Multiple top-level licenses: AND semantics.
  const overall = cats.reduce((acc, c) => (RISK_RANK[c] > RISK_RANK[acc] ? c : acc));
  // Canonical spdx string: re-join with " AND " for storage clarity. If only one,
  // store it bare.
  const spdx = cleaned.length === 1 ? cleaned[0]! : cleaned.join(" AND ");
  return { spdx, category: overall };
}
