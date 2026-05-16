import {
  type CheckWorkflowInput,
  type CheckWorkflowOutput,
  type WorkflowWarning,
} from "@refuse/shared";
import { type CardReader } from "../cards";
import { parseWorkflow } from "../parsers/workflow/parse";
import { batchCheck, summarize } from "./batch-check";
import type { ScannedPackage } from "./_trim";

type CheckWorkflowResult = CheckWorkflowOutput & { scanned: ScannedPackage[] };

const SHA_RE = /^[a-f0-9]{40}$/i;

export async function checkWorkflow(
  cards: CardReader,
  input: CheckWorkflowInput,
): Promise<CheckWorkflowResult> {
  const uses = parseWorkflow(input.content);
  const warnings: WorkflowWarning[] = [];
  const packages: Array<{ ecosystem: string; name: string; version: string }> = [];

  for (const u of uses) {
    if (!u.name) continue; // local/docker — skip silently
    if (!u.ref) {
      warnings.push({
        type: "unpinned_action",
        line: u.line,
        message: `\`${u.raw}\` has no ref. Pin to a tag or full commit SHA.`,
      });
      continue;
    }
    if (u.ref === "master" || u.ref === "main") {
      warnings.push({
        type: "uses_master_or_main",
        line: u.line,
        message: `\`${u.raw}\` follows a moving branch. Pin to a tag or commit SHA.`,
      });
    } else if (!SHA_RE.test(u.ref)) {
      warnings.push({
        type: "rolling_ref",
        line: u.line,
        message: `\`${u.raw}\` uses a tag (\`${u.ref}\`); consider pinning to a full commit SHA for supply-chain safety.`,
      });
    }
    packages.push({ ecosystem: "GitHub Actions", name: u.name, version: u.ref });
  }

  if (packages.length === 0) {
    return { results: [], warnings, summary: summarize([]), scanned: [] };
  }

  const batch = await batchCheck(cards, { packages });
  return {
    results: batch.results,
    warnings,
    summary: batch.summary,
    scanned: batch.scanned,
  };
}
