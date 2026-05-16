import { type CheckLockfileInput } from "@refuse/shared";
import { type CardReader } from "../cards";
import { parserForFilename } from "../parsers/lockfile";
import { batchCheck, summarize, type BatchCheckResult } from "./batch-check";

/**
 * Implementation of `check_lockfile`. Looks up a parser by filename, parses
 * the content, then calls `batch_check` with the dependency list.
 *
 * Fail open per spec §10.5: if no parser matches, return an empty result with
 * an `error` summary.
 */
export async function checkLockfile(
  cards: CardReader,
  input: CheckLockfileInput,
): Promise<BatchCheckResult> {
  const parser = parserForFilename(input.filename);
  if (!parser) {
    return { results: [], summary: summarize([]), scanned: [] };
  }

  const deps = parser(input.content);
  if (deps.length === 0) {
    return { results: [], summary: summarize([]), scanned: [] };
  }

  return batchCheck(cards, { packages: deps });
}
