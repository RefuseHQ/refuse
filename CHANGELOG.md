# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.

## [Unreleased]

### Added
- Community + governance docs: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CODEOWNERS`, issue + PR templates, `.editorconfig`, `ARCHITECTURE.md`, `ROADMAP.md`.
- Dependabot, CodeQL, lint workflows.

### Changed
- README polish: hero, badges, architecture diagram, cross-link to `refuse-cli`.

## [0.0.1] — initial

- HTTP server (Hono) with `/api/v1/check/*` endpoints.
- SQLite-backed card store with in-process scheduler (node-cron).
- Ingest adapters: OSV, deps.dev, CISA KEV, FIRST EPSS, GHSA, Wolfi.
- Lockfile parsers: npm, pnpm, Yarn (classic + Berry), Bun, pip, Poetry, Cargo, Go modules, RubyGems, Maven, NuGet, Hex, Pub, Packagist.
- Dockerfile + GitHub Actions workflow parsing.
- Multi-stage Docker image published to `ghcr.io/refusehq/refuse`.
- Embedded admin UI at `/ui/`.
- Optional bearer-token API auth.

[Unreleased]: https://github.com/RefuseHQ/refuse/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/RefuseHQ/refuse/releases/tag/v0.0.1
