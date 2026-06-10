# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0.

## [Unreleased]

## [0.1.4] — 2026-06-10

Cold-seed time drops from ~2h to ~3 min.

### Added
- `runOsvBootstrap` — on first boot, stream OSV's bulk `all.zip` (~200 MB compressed, every ecosystem) and seed all per-ecosystem watermarks in one pass.
- `REFUSE_OSV_CONCURRENCY` env var (default 4) — caps the number of ecosystems fetched in parallel each delta tick.
- `OsvFetcher.openAllArchive()` — streaming counterpart to `fetchAllArchive`.

### Changed
- `runOsvDelta` no longer round-robins one ecosystem per tick under a 60 s wall-clock cap. It now processes every ecosystem in parallel each tick with the configured concurrency. The 60 s budget was a Workers CPU-cap workaround that doesn't apply to a self-hosted Node runtime; on a populated DB, per-ecosystem deltas are tiny so each tick still completes in seconds.
- First-boot bootstrap now calls the new `osv:bulk` job (not the per-tick rotation) when OSV has never recorded a successful run, so Maven (Log4Shell), crates.io, Go, RubyGems etc. are populated within the first few minutes instead of after a 2-hour rotation.

## [0.1.3] — 2026-06-10

### Fixed
- OSV rotation no longer gets stuck on the first ecosystem when its watermark is current. Previously, every 5-minute tick spent the 60s budget reading the ~200 MB npm zip rejecting every record on the watermark, and the rotation cursor never advanced — PyPI / Maven / distros effectively starved. Now: if the budget expires with zero records processed (i.e. caught up), the cursor advances anyway.
- First-boot bootstrap is now per-source. An upgrade from an older image — where the volume has OSV data but the enrichment cron never fired — now kicks the enrichment job immediately instead of waiting up to 24 h for the next daily tick. Each ingestion source (`osv`, `deps_dev`, `kev`, `epss`, `ghsa_direct`, `wolfi`) is checked individually via `ingestion_state.last_ok_at`.

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

[Unreleased]: https://github.com/RefuseHQ/refuse/compare/v0.1.4...HEAD
[0.1.4]: https://github.com/RefuseHQ/refuse/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/RefuseHQ/refuse/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/RefuseHQ/refuse/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/RefuseHQ/refuse/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/RefuseHQ/refuse/releases/tag/v0.1.0
