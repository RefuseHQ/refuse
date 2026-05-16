import { matcherFamily } from "@refuse/shared";
import { semverMatcher } from "./semver";
import { pypiMatcher } from "./pypi";
import { rubyGemsMatcher } from "./rubygems";
import { mavenMatcher } from "./maven";
import { nugetMatcher } from "./nuget";
import { dpkgMatcher } from "./dpkg";
import { apkMatcher } from "./apk";
import { rpmMatcher } from "./rpm";
import { githubActionsMatcher } from "./github-actions";
import type { VersionMatcher } from "./types";

export type { VersionMatcher } from "./types";
export {
  semverMatcher,
  pypiMatcher,
  rubyGemsMatcher,
  mavenMatcher,
  nugetMatcher,
  dpkgMatcher,
  apkMatcher,
  rpmMatcher,
  githubActionsMatcher,
};

/**
 * Returns the matcher for an OSV ecosystem string. Throws if the ecosystem is
 * unknown.
 */
export function getMatcher(ecosystem: string): VersionMatcher {
  const family = matcherFamily(ecosystem);
  if (!family) {
    throw new Error(`Unsupported ecosystem: ${ecosystem}`);
  }
  switch (family) {
    case "semver":
      return semverMatcher;
    case "pypi":
      return pypiMatcher;
    case "rubygems":
      return rubyGemsMatcher;
    case "maven":
      return mavenMatcher;
    case "nuget":
      return nugetMatcher;
    case "dpkg":
      return dpkgMatcher;
    case "apk":
      return apkMatcher;
    case "rpm":
      return rpmMatcher;
    case "github-actions":
      return githubActionsMatcher;
  }
}
