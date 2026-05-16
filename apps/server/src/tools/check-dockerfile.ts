import {
  type CheckDockerfileInput,
  type CheckDockerfileOutput,
  type DockerfileWarning,
  normalizeEcosystem,
} from "@refuse/shared";
import { type CardReader } from "../cards";
import { parseDockerfile } from "../parsers/dockerfile/parse";
import { resolveBaseImage, type ResolvedBaseImage } from "../parsers/dockerfile/base-image";
import { parseRun } from "../parsers/dockerfile/run-commands";
import { batchCheck, summarize } from "./batch-check";
import type { ScannedPackage } from "./_trim";
import type { ParsedDependency } from "../parsers/lockfile/types";

type CheckDockerfileResult = CheckDockerfileOutput & { scanned: ScannedPackage[] };

export async function checkDockerfile(
  cards: CardReader,
  input: CheckDockerfileInput,
): Promise<CheckDockerfileResult> {
  const instructions = parseDockerfile(input.content);
  const warnings: DockerfileWarning[] = [];
  const packages: Array<ParsedDependency & { line: number }> = [];

  // Per-stage distro state. The stage's distro carries across RUN lines until
  // a new FROM resets it.
  const stageDistros = new Map<number, ResolvedBaseImage>();

  // Apply explicit hint to stage 0 if provided.
  const hintEcosystem = input.detected_distro
    ? normalizeEcosystem(input.detected_distro)
    : null;

  let detected_base_image: string | null = null;
  let detected_distro: string | null = null;

  for (const instr of instructions) {
    if (instr.name === "FROM") {
      const resolved = resolveBaseImage(instr.args);
      stageDistros.set(instr.stage, resolved);
      // Overwrite on every FROM so we end up reporting the FINAL stage's
      // base image — that's the one Docker actually produces as the runtime
      // image. Earlier stages are scratch/builder images the user discards.
      // We keep the user's `detected_distro` hint as fallback only when
      // the final stage's image can't be mapped.
      detected_base_image = resolved.rawImage;
      detected_distro = resolved.ecosystem ?? hintEcosystem;
      if (resolved.ecosystem === null && hintEcosystem === null) {
        warnings.push({
          type: "unknown_base_image",
          line: instr.startLine,
          message: `Could not map base image \`${resolved.rawImage}\` to a distro. Distro packages will not be scanned for this stage.`,
        });
      }
      if (/:latest$/.test(resolved.rawImage) || !/[:@]/.test(resolved.rawImage)) {
        warnings.push({
          type: "rolling_tag",
          line: instr.startLine,
          message: `Base image uses a rolling tag (\`${resolved.rawImage}\`). Pin to a specific version for reproducibility.`,
        });
      }
      continue;
    }

    if (instr.name !== "RUN") continue;

    const stageInfo = stageDistros.get(instr.stage);
    const ecosystem =
      stageInfo?.ecosystem ?? (instr.stage === 0 ? hintEcosystem : null);
    const family = stageInfo?.family ?? null;

    const { packages: runPkgs, warnings: runWarns } = parseRun(
      instr.args,
      ecosystem,
      family,
    );
    for (const p of runPkgs) packages.push({ ...p, line: instr.startLine });
    for (const w of runWarns) {
      warnings.push({
        type: w.type,
        line: instr.startLine,
        message: w.message,
      });
    }
  }

  const inputs = packages.map(({ ecosystem, name, version }) => ({
    ecosystem,
    name,
    version,
  }));

  // Packages we found but couldn't actually check — usually unpinned distro
  // installs (`apt-get install foo` with no version). Surface the count so
  // the caller can see coverage gaps; these don't get billed.
  const unscannable = warnings.filter(
    (w) => w.type === "unpinned_install",
  ).length;

  if (inputs.length === 0) {
    const empty = summarize([]);
    return {
      detected_base_image,
      detected_distro,
      results: [],
      warnings,
      summary: { ...empty, unscannable },
      scanned: [],
    };
  }

  const batchResult = await batchCheck(cards, { packages: inputs });

  return {
    detected_base_image,
    detected_distro,
    results: batchResult.results,
    warnings,
    summary: { ...batchResult.summary, unscannable },
    scanned: batchResult.scanned,
  };
}
