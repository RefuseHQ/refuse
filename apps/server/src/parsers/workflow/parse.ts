import { parse as parseYaml, parseDocument, isMap, isSeq, isScalar, isPair } from "yaml";

/**
 * Parse a GitHub Actions workflow file. Walks every `jobs.<id>.steps[].uses`
 * field (and reusable workflow `jobs.<id>.uses`), extracts `(owner/repo, ref)`
 * pairs, and surfaces line numbers via the YAML CST.
 *
 * Recognized warning conditions:
 * - `@master` / `@main`         — `uses_master_or_main`
 * - missing `@ref`              — `unpinned_action`
 * - tag-shaped ref like `v3`    — `rolling_ref` (vs SHA-pinned)
 *
 * Local action references (`./local/action`) and Docker references
 * (`docker://image:tag`) are skipped — they're not in OSV's `GitHub Actions`
 * ecosystem.
 */

export interface WorkflowUse {
  raw: string;             // "actions/checkout@v3"
  name: string | null;     // "actions/checkout" or null if unparseable
  ref: string | null;      // "v3" or null
  line: number;            // 1-based
}

export function parseWorkflow(content: string): WorkflowUse[] {
  // Validate YAML at all (so we don't try to walk a CST when the doc is bad).
  try {
    parseYaml(content);
  } catch {
    return [];
  }

  const doc = parseDocument(content, { keepSourceTokens: false });
  if (!doc.contents) return [];

  const out: WorkflowUse[] = [];
  walkNode(doc.contents, out, content);
  return out;
}

interface YamlNode {
  range?: [number, number, number] | [number, number] | undefined;
}

function walkNode(node: unknown, out: WorkflowUse[], source: string): void {
  if (isMap(node)) {
    for (const item of node.items) {
      if (!isPair(item)) continue;
      // The key tells us if we're at a `uses:` field.
      const keyVal = isScalar(item.key) ? String(item.key.value) : null;
      if (keyVal === "uses" && isScalar(item.value) && typeof item.value.value === "string") {
        const valueNode = item.value as YamlNode & { value: string };
        out.push({
          raw: valueNode.value,
          ...parseUses(valueNode.value),
          line: rangeToLine(valueNode.range, source),
        });
        continue;
      }
      walkNode(item.value, out, source);
    }
  } else if (isSeq(node)) {
    for (const item of node.items) walkNode(item, out, source);
  }
}

function parseUses(raw: string): { name: string | null; ref: string | null } {
  // Skip local and Docker references.
  if (raw.startsWith("./") || raw.startsWith("docker://")) {
    return { name: null, ref: null };
  }
  const at = raw.lastIndexOf("@");
  if (at <= 0) return { name: raw, ref: null };
  return { name: raw.slice(0, at), ref: raw.slice(at + 1) };
}

function rangeToLine(range: YamlNode["range"], source: string): number {
  if (!range) return 1;
  const offset = range[0];
  if (typeof offset !== "number") return 1;
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}
