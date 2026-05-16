import { z } from "zod";

/**
 * OSV record schema — just the fields we consume during ingestion. The full
 * schema is at https://ossf.github.io/osv-schema/. We use `passthrough()` so
 * unrecognized fields are preserved when storing the raw record in D1.
 */

const OsvSeverity = z.object({
  type: z.string(),       // typically "CVSS_V3" or "CVSS_V4"
  score: z.string(),      // CVSS vector string
});

const OsvReference = z.object({
  type: z.string(),
  url: z.string(),
});

const OsvEvent = z
  .object({
    introduced: z.string().optional(),
    fixed: z.string().optional(),
    last_affected: z.string().optional(),
    limit: z.string().optional(),
  })
  .strict();

const OsvRange = z.object({
  type: z.enum(["ECOSYSTEM", "SEMVER", "GIT"]),
  repo: z.string().optional(),
  events: z.array(OsvEvent),
});

const OsvPackage = z.object({
  ecosystem: z.string(),
  name: z.string(),
  purl: z.string().optional(),
});

const OsvAffected = z.object({
  package: OsvPackage.optional(),
  ranges: z.array(OsvRange).optional(),
  versions: z.array(z.string()).optional(),
});

export const OsvRecord = z
  .object({
    schema_version: z.string().optional(),
    id: z.string(),
    aliases: z.array(z.string()).optional(),
    related: z.array(z.string()).optional(),
    summary: z.string().optional(),
    details: z.string().optional(),
    published: z.string(),
    modified: z.string(),
    withdrawn: z.string().optional(),
    severity: z.array(OsvSeverity).optional(),
    affected: z.array(OsvAffected).optional(),
    references: z.array(OsvReference).optional(),
  })
  .passthrough();

export type OsvRecord = z.infer<typeof OsvRecord>;
export type OsvAffected = z.infer<typeof OsvAffected>;
export type OsvRange = z.infer<typeof OsvRange>;
export type OsvEvent = z.infer<typeof OsvEvent>;
