import { XMLParser } from "fast-xml-parser";
import type { ParsedDependency, LockfileParser } from "./types";

/**
 * Parse Maven `pom.xml`. We extract `<dependency>` blocks under the top-level
 * `<dependencies>` AND under `<dependencyManagement>/<dependencies>`. Skip
 * entries without an explicit `<version>` (those rely on a parent POM or
 * BOM that we don't resolve here).
 *
 * Maven coordinates are `groupId:artifactId`; that's the OSV-canonical name.
 */
export const parsePomXml: LockfileParser = (content) => {
  let parsed: unknown;
  try {
    parsed = new XMLParser({ ignoreAttributes: true, parseTagValue: false }).parse(content);
  } catch {
    return [];
  }
  const project = (parsed as { project?: ProjectNode }).project;
  if (!project) return [];

  const out: ParsedDependency[] = [];
  collect(project.dependencies?.dependency, out);
  collect(project.dependencyManagement?.dependencies?.dependency, out);
  return out;
};

interface DepNode {
  groupId?: string;
  artifactId?: string;
  version?: string;
}

interface DepListNode {
  dependency?: DepNode | DepNode[];
}

interface ProjectNode {
  dependencies?: DepListNode;
  dependencyManagement?: { dependencies?: DepListNode };
}

function collect(deps: DepNode | DepNode[] | undefined, out: ParsedDependency[]): void {
  if (!deps) return;
  const list = Array.isArray(deps) ? deps : [deps];
  for (const d of list) {
    if (!d.groupId || !d.artifactId || !d.version) continue;
    if (typeof d.version !== "string" || d.version.startsWith("${")) continue; // unresolved property
    out.push({
      ecosystem: "Maven",
      name: `${d.groupId}:${d.artifactId}`,
      version: d.version,
    });
  }
}
