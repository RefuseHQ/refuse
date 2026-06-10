# Roadmap

This is a living document. Dates are intentionally absent — we ship when it's ready, not when a calendar entry fires.

For the latest, see the [GitHub project board](https://github.com/orgs/RefuseHQ/projects) and the [`milestone:`](https://github.com/RefuseHQ/refuse/milestones) labels.

## Recently shipped

- [x] First tagged release ([v0.1.0](https://github.com/RefuseHQ/refuse/releases/tag/v0.1.0)) — `ghcr.io/refusehq/refuse:latest` is published, multi-arch (amd64 + arm64), cosign-signed with SLSA build provenance and SBOM attached.
- [x] **Bulk first-boot seed** — streams OSV's bulk `all.zip` so the cold seed is ~3 min instead of the ~2 h round-robin.
- [x] **Parallel per-tick deltas** — every ecosystem refreshed each cron tick, bounded by `REFUSE_OSV_CONCURRENCY` (default 4).
- [x] **`/readyz` endpoint** — 503 with `pending_sources` during bootstrap, 200 once every required source has a `last_ok_at`. Suitable for `docker --health-cmd` and k8s readinessProbe.
- [x] **Per-source bootstrap on empty DB** — kicks `osv-bulk` + `deps-dev` + `enrichment` in parallel instead of waiting up to 24 h for the daily enrichment cron.
- [x] **Visual progress bars** in `docker logs` for every ingest source — start / progress / done lines with a 20-char ASCII bar.
- [x] **Persistent `/data` volume** documented in Quickstart so a `docker run` survives restarts without re-seeding.
- [x] `better-sqlite3` 12 — Node 24 prebuilt binary lets the Docker build skip the native compile, multi-arch release time dropped from ~15 min to ~3 min.
- [x] Path-filtered CI + Dependabot grouping/auto-merge so doc-only and infra PRs skip the heavy jobs.

## Towards 0.2.0

- [ ] **MCP endpoint** — wire up the Streamable HTTP MCP transport (currently stubbed at `/mcp`). Same six tools as the REST surface, but available over the MCP protocol.
- [ ] **`refuse-mode: warn`** — a threshold tier that logs but doesn't block, for soft-rollouts.
- [ ] **Better admin UI** — searchable card lookups, ingest run history, key management without poking the REST API.
- [ ] **Webhook events** — emit a webhook when a card transitions from "safe" to "vulnerable" so downstream tools can re-scan.
- [ ] **More ecosystems** — Conda, Swift Package Manager. Community PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md#adding-a-new-ecosystem).
- [ ] **Helm chart** — deploy to Kubernetes in two commands.
- [ ] **Test coverage gate** — fail CI if line coverage drops below 70%.

## Towards 1.0

- [ ] **Stable HTTP API.** Today everything is `/api/v1` but the v1 contract isn't frozen.
- [ ] **Pluggable data sources.** A documented adapter API so third parties can add private feeds (internal advisories, paid sources) without forking.
- [ ] **PostgreSQL backend (optional)** — for teams that don't want a SQLite WAL on a single host. SQLite stays the default.
- [ ] **Multi-tenant API keys** — per-team scoping, per-key rate limits.
- [ ] **GitHub App** — surface refuse decisions as PR checks without needing the CLI in CI.
- [ ] **LTS branch** — once 1.0 ships, we'll backport security fixes for a defined window.

## How to influence this

- Open a [Discussion](https://github.com/RefuseHQ/refuse/discussions) with the use case.
- Or, ship a PR. The roadmap is a list of things we'd like to do — it is not a list of things only maintainers can do.
