import type { ParsedDependency, LockfileParser } from "./types";

/**
 * Parse Elixir `mix.lock`. The file is a single Erlang map literal:
 *
 *   %{
 *     "phoenix": {:hex, :phoenix, "1.7.0", "<hash>", ...},
 *     "ecto": {:hex, :ecto, "3.10.0", ...},
 *   }
 *
 * Only `:hex` source entries map to Hex packages. `:git`/`:path` entries are
 * skipped — they don't have canonical Hex versions to look up.
 */
export const parseMixLock: LockfileParser = (content) => {
  const out: ParsedDependency[] = [];
  // Match: "name": {:hex, :name, "version",
  const re = /"([^"]+)":\s*\{\s*:hex\s*,\s*:[^,]+\s*,\s*"([^"]+)"/g;
  for (const m of content.matchAll(re)) {
    out.push({ ecosystem: "Hex", name: m[1]!, version: m[2]! });
  }
  return out;
};
