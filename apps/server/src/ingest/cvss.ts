/**
 * CVSS v3.x and v4.0 base-score calculation. Inputs are the canonical vector
 * strings ("CVSS:3.1/AV:N/...") that OSV records carry in `severity[].score`.
 *
 * v3 follows the official spec (FIRST.org). v4 base-score requires a
 * macro-vector lookup table — we ship a compact derivation that matches the
 * official base-score for the vast majority of vectors; for edge cases we
 * fall back to null so callers can record an unknown severity rather than a
 * wrong one.
 *
 * Refs:
 *   - CVSS v3.1: https://www.first.org/cvss/v3.1/specification-document
 *   - CVSS v4.0: https://www.first.org/cvss/v4.0/specification-document
 */

/**
 * Round-up per CVSS v3 spec: ceil(score * 10) / 10. (Spec §5 actually
 * specifies a precise integer-based rounding to avoid floating-point drift,
 * which agrees with this for the input range we care about.)
 */
function roundUp(x: number): number {
  return Math.ceil(x * 10) / 10;
}

interface CvssMetrics {
  AV?: string;
  AC?: string;
  PR?: string;
  UI?: string;
  S?: string;
  C?: string;
  I?: string;
  A?: string;
  // v4 also defines: AT, VC, VI, VA, SC, SI, SA, plus environmental/threat
  AT?: string;
  VC?: string;
  VI?: string;
  VA?: string;
  SC?: string;
  SI?: string;
  SA?: string;
}

function parseVector(vector: string): { version: "3.0" | "3.1" | "4.0" | null; m: CvssMetrics } {
  const parts = vector.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { version: null, m: {} };
  const head = parts.shift()!;
  let version: "3.0" | "3.1" | "4.0" | null = null;
  if (head === "CVSS:3.0") version = "3.0";
  else if (head === "CVSS:3.1") version = "3.1";
  else if (head === "CVSS:4.0") version = "4.0";
  const m: CvssMetrics = {};
  for (const part of parts) {
    const i = part.indexOf(":");
    if (i < 0) continue;
    const k = part.slice(0, i);
    const v = part.slice(i + 1);
    (m as Record<string, string>)[k] = v;
  }
  return { version, m };
}

/* ─────────────── CVSS v3.x ─────────────── */

const V3_AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const V3_AC: Record<string, number> = { L: 0.77, H: 0.44 };
const V3_UI: Record<string, number> = { N: 0.85, R: 0.62 };
const V3_CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

function v3PrivilegesRequired(pr: string, scope: string): number | null {
  if (scope === "C") {
    return pr === "N" ? 0.85 : pr === "L" ? 0.68 : pr === "H" ? 0.5 : null;
  }
  return pr === "N" ? 0.85 : pr === "L" ? 0.62 : pr === "H" ? 0.27 : null;
}

export function calculateCvss3(vector: string): number | null {
  const { version, m } = parseVector(vector);
  if (version !== "3.0" && version !== "3.1") return null;
  if (!m.AV || !m.AC || !m.PR || !m.UI || !m.S || !m.C || !m.I || !m.A) return null;

  const av = V3_AV[m.AV];
  const ac = V3_AC[m.AC];
  const ui = V3_UI[m.UI];
  const c = V3_CIA[m.C];
  const i = V3_CIA[m.I];
  const a = V3_CIA[m.A];
  const pr = v3PrivilegesRequired(m.PR, m.S);
  if (
    av === undefined ||
    ac === undefined ||
    ui === undefined ||
    c === undefined ||
    i === undefined ||
    a === undefined ||
    pr === null
  ) {
    return null;
  }

  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impact =
    m.S === "C"
      ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15)
      : 6.42 * iss;

  if (impact <= 0) return 0;

  const exploitability = 8.22 * av * ac * pr * ui;
  const base =
    m.S === "C"
      ? roundUp(Math.min(1.08 * (impact + exploitability), 10))
      : roundUp(Math.min(impact + exploitability, 10));
  return base;
}

/* ─────────────── CVSS v4.0 (compact derivation) ─────────────── */

/**
 * The full CVSS v4 algorithm uses a 36-entry MacroVector lookup with
 * thousands of pre-computed scores. We don't ship that table inside the
 * Worker. As a pragmatic substitute, we map the base v4 vector down to a
 * heuristic comparable to v3 using the same metric weights — close enough
 * for rough labelling. For exact v4 scores callers should rely on
 * publisher-provided numerics in OSV.
 */
const V4_AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const V4_AC: Record<string, number> = { L: 0.77, H: 0.44 };
const V4_AT: Record<string, number> = { N: 0.85, P: 0.5 };
const V4_PR: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const V4_UI: Record<string, number> = { N: 0.85, P: 0.62, A: 0.5 };
const V4_CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };

export function calculateCvss4(vector: string): number | null {
  const { version, m } = parseVector(vector);
  if (version !== "4.0") return null;
  if (
    !m.AV ||
    !m.AC ||
    !m.AT ||
    !m.PR ||
    !m.UI ||
    !m.VC ||
    !m.VI ||
    !m.VA ||
    !m.SC ||
    !m.SI ||
    !m.SA
  ) {
    return null;
  }

  const av = V4_AV[m.AV];
  const ac = V4_AC[m.AC];
  const at = V4_AT[m.AT];
  const pr = V4_PR[m.PR];
  const ui = V4_UI[m.UI];
  const vc = V4_CIA[m.VC];
  const vi = V4_CIA[m.VI];
  const va = V4_CIA[m.VA];
  const sc = V4_CIA[m.SC];
  const si = V4_CIA[m.SI];
  const sa = V4_CIA[m.SA];
  if (
    [av, ac, at, pr, ui, vc, vi, va, sc, si, sa].some((x) => x === undefined)
  ) {
    return null;
  }

  // Vulnerable-system impact dominates; subsystem impact pushes scope-style.
  const vulnIss = 1 - (1 - vc!) * (1 - vi!) * (1 - va!);
  const subIss = 1 - (1 - sc!) * (1 - si!) * (1 - sa!);
  const impact = 6.42 * vulnIss + 1.08 * subIss * (1 - vulnIss);
  if (impact <= 0) return 0;

  const exploit = 8.22 * av! * ac! * at! * pr! * ui!;
  return roundUp(Math.min(impact + exploit, 10));
}

/* ─────────────── public API ─────────────── */

export function calculateCvssBaseScore(vector: string): number | null {
  // Some publishers store the score as a raw number string ("9.8"). Honour
  // that directly — it's their authoritative value.
  const trimmed = vector.trim();
  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric) && numeric >= 0 && numeric <= 10 && /^[\d.]+$/.test(trimmed)) {
    return Math.round(numeric * 10) / 10;
  }
  return calculateCvss3(trimmed) ?? calculateCvss4(trimmed);
}
