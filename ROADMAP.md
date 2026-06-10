# Roadmap

This is a living document. Dates are intentionally absent — we ship when it's ready, not when a calendar entry fires.

For the latest, see the [GitHub project board](https://github.com/orgs/RefuseHQ/projects) and the [`milestone:`](https://github.com/RefuseHQ/refuse/milestones) labels.

## Status: Alpha

refuse is usable today, but the API may change between minor versions. Don't bet a production deploy on `main` without pinning.

## Near-term — towards 0.1.0

- [ ] **MCP endpoint** — wire up the Streamable HTTP MCP transport (currently stubbed at `/mcp`). Same six tools as the REST surface, but available over the MCP protocol for compatible clients.
- [ ] **Test coverage thresholds** — fail CI if line coverage drops below 70%.
- [x] **Signed container image** — cosign-sign `ghcr.io/refusehq/refuse` and publish provenance.
- [x] **SBOM** — attach a CycloneDX SBOM to every release.
- [ ] Document `cosign verify` + `slsa-verifier verify-image` in SECURITY.md (paired with the SECURITY change in this PR).
- [ ] **`refuse-mode: warn`** — a new threshold tier that logs but doesn't block, for soft-rollouts.
- [ ] **Better admin UI** — searchable card lookups, ingest run history, key management.

## Medium-term — towards 0.2.0

- [ ] **PostgreSQL backend (optional)** — for teams that don't want a SQLite WAL on a single host. SQLite stays the default.
- [ ] **Webhook events** — emit a webhook when a card transitions from "safe" to "vulnerable" so downstream tools can re-scan.
- [ ] **GitHub App** — surface refuse decisions as PR checks without needing the CLI in CI.
- [ ] **Helm chart** — deploy to Kubernetes in two commands.
- [ ] **More ecosystems** — Conda, Swift Package Manager, Hex, Pub. Community PRs welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md#adding-a-new-ecosystem).

## Longer-term — towards 1.0

- [ ] **Stable HTTP API.** Today everything is `/api/v1` but the v1 contract isn't frozen.
- [ ] **Pluggable data sources.** A documented adapter API so third parties can add private feeds (internal advisories, paid sources) without forking.
- [ ] **Multi-tenant API keys** — per-team scoping, per-key rate limits.
- [ ] **LTS branch** — once 1.0 ships, we'll backport security fixes for a defined window.

## Out of scope (probably forever)

- Scanning running containers or live deployments. That's runtime security, a different problem.
- A general policy engine. Severity threshold + fail mode is the surface area; we'd rather stay opinionated.
- Vendor-specific integrations baked into the OSS server. Those belong in third-party adapters or downstream forks.

## How to influence this

- Open a [Discussion](https://github.com/RefuseHQ/refuse/discussions) with the use case.
- Or, ship a PR. The roadmap is a list of things we'd like to do — it is not a list of things only maintainers can do.
