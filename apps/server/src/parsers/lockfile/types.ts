/**
 * Common types for lockfile parsers. Each parser takes the file content and
 * returns a flat list of `(ecosystem, name, version)` triples — every
 * concrete package the lockfile pins, including transitives.
 *
 * Parsers SHOULD return an empty list on malformed input rather than throw.
 * The check_lockfile tool fails open on parse errors per spec §10.5.
 */

export interface ParsedDependency {
  ecosystem: string;
  name: string;
  version: string;
}

export type LockfileParser = (content: string) => ParsedDependency[];
