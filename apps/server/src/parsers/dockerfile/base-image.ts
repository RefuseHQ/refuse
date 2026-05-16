/**
 * Map a Dockerfile FROM image reference to an OSV distro ecosystem string
 * (e.g. `"Debian:12"`, `"Alpine:v3.19"`). Resolution order per spec §10.7:
 *
 * 1. Explicit caller hint (handled by the tool, not here).
 * 2. Tag-derived: `python:3.11-bookworm` → `Debian:12`, `python:3.11-bullseye`
 *    → `Debian:11`, `*-alpine3.19` → `Alpine:v3.19`, etc.
 * 3. Family fallback: `python:*-slim` → current Debian stable.
 * 4. Unknown → null.
 *
 * Returns the canonical distro string AND the family for downstream RUN parsing.
 */

export type DistroFamily = "debian" | "alpine" | "rpm" | null;

export interface ResolvedBaseImage {
  rawImage: string;           // "python:3.11-slim"
  ecosystem: string | null;   // "Debian:12" | null
  family: DistroFamily;       // "debian" | "alpine" | "rpm" | null
}

const DEBIAN_CODENAME_TO_VERSION: Record<string, string> = {
  bookworm: "12",
  bullseye: "11",
  buster: "10",
  stretch: "9",
};
const UBUNTU_CODENAME_TO_VERSION: Record<string, string> = {
  noble: "24.04",
  jammy: "22.04",
  focal: "20.04",
  bionic: "18.04",
};
/** Default when a Debian/Ubuntu derivative is detected without an explicit codename. */
const DEFAULT_DEBIAN_VERSION = "12";

export function resolveBaseImage(fromArgs: string): ResolvedBaseImage {
  // FROM args can have flags (`--platform=linux/amd64`) and aliases (`AS build`).
  // We want the bare image reference.
  const parts = fromArgs
    .split(/\s+/)
    .filter((p) => !p.startsWith("--") && p.toUpperCase() !== "AS");
  let imageRef: string | undefined = parts[0];
  // If "FROM image AS alias" is parsed, parts[0] is the image.
  // If "FROM --platform=X image AS alias" → parts[0] is also the image.

  if (!imageRef) return { rawImage: fromArgs, ecosystem: null, family: null };

  // Strip digest (`@sha256:...`) and split out tag.
  imageRef = imageRef.split("@")[0]!;
  const colonIdx = imageRef.lastIndexOf(":");
  const lastSlash = imageRef.lastIndexOf("/");
  // A `:` after the last `/` is the tag separator. A `:` before is part of
  // the registry (port).
  const hasTag = colonIdx > lastSlash;
  const repo = hasTag ? imageRef.slice(0, colonIdx) : imageRef;
  const tag = hasTag ? imageRef.slice(colonIdx + 1) : "latest";

  // Keep only the image name segment (drop registry and any namespacing).
  const name = repo.split("/").pop() ?? repo;
  const lowerTag = tag.toLowerCase();

  const matchAlpine = lowerTag.match(/alpine(?:[:-]?v?(\d+\.\d+(?:\.\d+)?))?/);
  if (matchAlpine || name === "alpine" || name === "chainguard") {
    let version: string | null = null;
    if (matchAlpine?.[1]) version = matchAlpine[1];
    else if (name === "alpine") version = lowerTag === "latest" ? null : lowerTag;
    if (version) {
      // Normalize 3.19 → v3.19; 3.19.1 → v3.19.
      const major = version.split(".").slice(0, 2).join(".");
      return { rawImage: imageRef, ecosystem: `Alpine:v${major}`, family: "alpine" };
    }
    return { rawImage: imageRef, ecosystem: null, family: "alpine" };
  }

  // Debian-codename suffix: "python:3.11-bookworm", "ruby:3.2-bullseye-slim".
  for (const [codename, version] of Object.entries(DEBIAN_CODENAME_TO_VERSION)) {
    if (lowerTag.includes(codename)) {
      return { rawImage: imageRef, ecosystem: `Debian:${version}`, family: "debian" };
    }
  }

  // Ubuntu codename suffix or `ubuntu:N.NN` numeric tag.
  for (const [codename, version] of Object.entries(UBUNTU_CODENAME_TO_VERSION)) {
    if (lowerTag.includes(codename)) {
      return { rawImage: imageRef, ecosystem: `Ubuntu:${version}`, family: "debian" };
    }
  }
  if (name === "ubuntu") {
    const v = /^\d+\.\d+$/.test(lowerTag) ? lowerTag : "22.04";
    return { rawImage: imageRef, ecosystem: `Ubuntu:${v}`, family: "debian" };
  }

  if (name === "debian") {
    const v = /^\d+/.test(lowerTag) ? lowerTag.split(/[-_]/)[0]! : DEFAULT_DEBIAN_VERSION;
    return { rawImage: imageRef, ecosystem: `Debian:${v}`, family: "debian" };
  }

  // Common Debian-derived bases: python, node (default), ruby, golang, openjdk.
  // node:*-slim, python:*-slim, etc. → Debian latest.
  const debianDerived = ["python", "node", "ruby", "golang", "openjdk", "buildpack-deps"];
  if (debianDerived.includes(name)) {
    return {
      rawImage: imageRef,
      ecosystem: `Debian:${DEFAULT_DEBIAN_VERSION}`,
      family: "debian",
    };
  }

  // RPM-based.
  if (name === "rockylinux" || name === "rocky") {
    const v = lowerTag.split(/[.-]/)[0] ?? "9";
    return { rawImage: imageRef, ecosystem: `Rocky Linux:${v}`, family: "rpm" };
  }
  if (name === "almalinux") {
    const v = lowerTag.split(/[.-]/)[0] ?? "9";
    return { rawImage: imageRef, ecosystem: `AlmaLinux:${v}`, family: "rpm" };
  }
  if (name === "registry.access.redhat.com" || name === "ubi8" || name === "ubi9") {
    return { rawImage: imageRef, ecosystem: "Red Hat", family: "rpm" };
  }

  return { rawImage: imageRef, ecosystem: null, family: null };
}
