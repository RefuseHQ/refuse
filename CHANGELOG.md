# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.

## [Unreleased]

## [0.1.2] — 2026-06-10

UX-only release: visible progress in `docker logs`.

### Added
- Per-source ingestion progress lines with a 20-char ASCII bar in `docker logs`. Streaming sources (OSV per-ecosystem, EPSS) fill the bar against a calibrated per-ecosystem estimate; known-total sources (KEV, GHSA page, Wolfi, deps.dev batch) show real percentages. Fixed-width tag column so the bars align.

### Changed
- Per-source log lines now share a consistent `refuse: ingest[name] ▶/✓/✗ …` prefix instead of ad-hoc `KEV: fetched=… upserted=…` strings. Greppable and easier to read in `docker logs -f`.

## [0.1.1] — 2026-06-10

First-boot UX + faster release builds. No API breakage.

### Added
- `GET /readyz` — returns 200 once every required ingestion source (osv, kev, epss, ghsa_direct, wolfi) has completed at least one successful pass; 503 with the pending list during bootstrap. Suitable for `docker --health-cmd` and k8s readinessProbe.
- Per-source readiness snapshot via `scheduler.getReadiness()` (also exposed in the response body of `/readyz`).
- KEV / EPSS / Wolfi now record `ingestion_state` rows so the admin `/api/admin/sources` panel shows their last-run status, matching the existing OSV + GHSA behavior.

### Changed
- First-boot bootstrap now kicks all three jobs (osv, deps-dev, enrichment) in parallel instead of only osv. KEV / EPSS / GHSA / Wolfi load in the first minute of uptime instead of waiting for the daily 5am UTC enrichment cron.
- `better-sqlite3` 11 → 12. Ships a prebuilt binary for Node 24 (ABI v137) on both `linux-x64` and `linux-arm64`, so the runtime image no longer needs python3/make/g++ to source-compile sqlite3 on first install. Multi-arch release builds drop from ~15 min to ~2 min.

### Removed
- `docker/Dockerfile` no longer installs build tools (python3, make, g++) in either stage — the prebuilt better-sqlite3 binary makes them unnecessary.

## [0.1.0] — 2026-06-10

First tagged release. The codebase has been usable for a while; this is the
first version where the container image at `ghcr.io/refusehq/refuse:latest`
actually exists.

### Added
- Community + governance docs: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CODEOWNERS`, issue + PR templates, `.editorconfig`, `ARCHITECTURE.md`, `ROADMAP.md`.
- Dependabot and CodeQL workflows.
- Cosign keyless signing + SLSA build provenance on every published image.

### Changed
- README polish: hero, badges, architecture diagram, cross-link to `refuse-cli`.

## [0.0.1] — initial codebase (untagged, never published)

- HTTP server (Hono) with `/api/v1/check/*` endpoints.
- SQLite-backed card store with in-process scheduler (node-cron).
- Ingest adapters: OSV, deps.dev, CISA KEV, FIRST EPSS, GHSA, Wolfi.
- Lockfile parsers: npm, pnpm, Yarn (classic + Berry), Bun, pip, Poetry, Cargo, Go modules, RubyGems, Maven, NuGet, Hex, Pub, Packagist.
- Dockerfile + GitHub Actions workflow parsing.
- Multi-stage Docker image published to `ghcr.io/refusehq/refuse`.
- Embedded admin UI at `/ui/`.
- Optional bearer-token API auth.

[Unreleased]: https://github.com/RefuseHQ/refuse/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/RefuseHQ/refuse/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/RefuseHQ/refuse/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/RefuseHQ/refuse/releases/tag/v0.1.0
