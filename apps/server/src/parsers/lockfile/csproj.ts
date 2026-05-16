import { XMLParser } from "fast-xml-parser";
import type { ParsedDependency, LockfileParser } from "./types";

/**
 * Parse a .NET `*.csproj` file. We extract `<PackageReference>` entries with
 * their `Include` (name) and `Version` attributes.
 *
 * Two attribute styles exist:
 *   <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />
 *   <PackageReference Include="Newtonsoft.Json"><Version>13.0.3</Version></PackageReference>
 *
 * fast-xml-parser surfaces attributes as `@_attr` keys when ignoreAttributes=false.
 */
export const parseCsproj: LockfileParser = (content) => {
  let parsed: unknown;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseAttributeValue: false,
      parseTagValue: false,
    }).parse(content);
  } catch {
    return [];
  }

  const project = (parsed as { Project?: ProjectNode }).Project;
  if (!project) return [];

  const out: ParsedDependency[] = [];
  const itemGroups = project.ItemGroup;
  if (!itemGroups) return out;
  const groups = Array.isArray(itemGroups) ? itemGroups : [itemGroups];

  for (const g of groups) {
    const refs = g.PackageReference;
    if (!refs) continue;
    const list = Array.isArray(refs) ? refs : [refs];
    for (const ref of list) {
      const name = ref["@_Include"];
      const version = ref["@_Version"] ?? ref.Version;
      if (typeof name !== "string" || typeof version !== "string") continue;
      out.push({ ecosystem: "NuGet", name, version });
    }
  }
  return out;
};

interface PackageReferenceNode {
  "@_Include"?: string;
  "@_Version"?: string;
  Version?: string;
}

interface ItemGroupNode {
  PackageReference?: PackageReferenceNode | PackageReferenceNode[];
}

interface ProjectNode {
  ItemGroup?: ItemGroupNode | ItemGroupNode[];
}
