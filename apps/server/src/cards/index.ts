/**
 * Compatibility helper that mirrors the `readCard(kv, ecosystem, name)`
 * signature the vendored tools were written against. Lets the tool files port
 * verbatim with only the import line changing.
 */

import type { VulnCard } from "@refuse/shared";
import type { CardReader } from "./reader";

export { makeCardReader, type CardReader, type CardReaderConfig } from "./reader";

export async function readCard(
  reader: CardReader,
  ecosystem: string,
  name: string,
): Promise<VulnCard | null> {
  return reader.readCard(ecosystem, name);
}
