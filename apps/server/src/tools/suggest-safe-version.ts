import {
  type SuggestSafeVersionInput,
  type SuggestSafeVersionOutput,
  normalizeEcosystem,
  canonicalizePackageName,
} from "@refuse/shared";
import { readCard, type CardReader } from "../cards";
import { checkPackage } from "./check-package";

/**
 * Implementation of `suggest_safe_version`. If `current_version` is provided,
 * we delegate to `check_package` and return its suggested_fixes. Otherwise we
 * just return the card's latest_stable / latest_any (no advisory matching to
 * do without a current version).
 */
export async function suggestSafeVersion(
  cards: CardReader,
  input: SuggestSafeVersionInput,
): Promise<SuggestSafeVersionOutput> {
  if (input.current_version) {
    const checked = await checkPackage(cards, {
      ecosystem: input.ecosystem,
      name: input.name,
      version: input.current_version,
    });
    return {
      package: checked.package,
      current_version: input.current_version,
      suggestions: checked.suggested_fixes,
    };
  }

  const ecosystem = normalizeEcosystem(input.ecosystem);
  if (!ecosystem) {
    return { package: input.name, current_version: null, suggestions: [] };
  }
  const name = canonicalizePackageName(ecosystem, input.name);

  const card = await readCard(cards, ecosystem, name);
  if (card === null) {
    return { package: name, current_version: null, suggestions: [] };
  }

  const suggestions: SuggestSafeVersionOutput["suggestions"] = [];
  if (card.latest_stable) {
    suggestions.push({
      version: card.latest_stable,
      type: "latest_stable",
      breaking_change: false,
      rationale: "Latest stable release.",
    });
  }
  if (card.latest_any && card.latest_any !== card.latest_stable) {
    suggestions.push({
      version: card.latest_any,
      type: "latest",
      breaking_change: false,
      rationale: "Latest release (may be a pre-release).",
    });
  }

  return { package: name, current_version: null, suggestions };
}
