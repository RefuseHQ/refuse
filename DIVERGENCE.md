# Divergence policy

`refuse` (this repo) is an open-source edition of a server that also runs as a hosted service at refuse.dev. The hosted edition is closed source and lives in a private upstream maintained by RefuseHQ. This document describes how the two stay in step.

## What stays in sync

These are the parts that should be near-identical between editions:

- **Vulnerability sources** — OSV / deps.dev / CISA KEV / EPSS / GitHub Security Advisories / Wolfi. The puller code is in [`apps/server/src/ingest/sources/`](apps/server/src/ingest/sources/).
- **Version matchers** — the per-ecosystem range parsers in [`packages/versions/`](packages/versions/).
- **Schema and ecosystem normalization** — the shared zod schemas in [`packages/shared/`](packages/shared/).
- **MCP tool handlers** — the six tools (`check_package`, `batch_check`, `check_lockfile`, `check_dockerfile`, `check_workflow`, `suggest_safe_version`) in [`apps/server/src/tools/`](apps/server/src/tools/).
- **Database schema** for vulnerability data: `vulnerabilities`, `affected_packages`, `package_versions`, `kev`, `epss`, `ingestion_state`.

When the upstream lands a new ecosystem, a new source, or a matcher fix, a maintainer cherry-picks the change over to this repo on a roughly bi-weekly cadence (or sooner for security fixes).

OSS-originated improvements get merged back into upstream the same way.

## What never crosses over

- **Multi-tenant auth** — WorkOS / AuthKit. This repo has either no auth (default) or a simple optional bearer-key model.
- **Billing** — subscription handling, payment provider integration, plan-tier quotas. Hosted has these; OSS does not.
- **`users`, `usage_counters`, `request_logs`** tables — single-tenant OSS doesn't need per-user state. The `api_keys` table is simplified (no owner column).
- **Cloudflare Workers runtime adapters** — D1 bindings, KV bindings, `ctx.waitUntil`, edge caching. The OSS server uses Node + Hono + better-sqlite3 with cron in-process.
- **Marketing site + portal UI** — those live in the hosted repo.
- **Proprietary enrichment** — any signals the hosted edition adds beyond public sources stay in the hosted repo.

## What's OSS-only

- The Docker delivery surface, embedded UI, configuration model, and self-hosting docs are owned by this repo. Changes here don't necessarily need to land upstream.

## Reporting issues

For bugs in matchers, sources, or anything in the "stays in sync" list, file in either repo and we'll route as needed. For OSS-specific issues (Docker, env config, embedded UI), this repo.
