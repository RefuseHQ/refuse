# Divergence: OSS vs hosted

This repo is the open-source server. The hosted edition at `mcp.refuse.dev` runs the same scanner against the same advisory feeds — what differs is the deployment shape and the per-tenant features that only make sense on the managed offering.

This file is the source of truth for what's in each edition. If a feature lands in one but not the other, file it here.

## Surfaces

| Surface | OSS (this repo) | Hosted (mcp.refuse.dev) |
| --- | --- | --- |
| REST API at `/api/v1/check/*` | ✓ | ✓ |
| MCP transport at `POST /mcp` | ✗ (501 stub today — on roadmap) | ✓ |
| Admin UI at `/ui/` | ✓ (per-instance) | ✓ (multi-tenant at `app.refuse.dev`) |
| Healthz at `/healthz` | ✓ | ✓ |

## Scanner

| Capability | OSS | Hosted |
| --- | --- | --- |
| Same advisory sources (OSV, GHSA, CISA KEV, EPSS, deps.dev metadata, Wolfi) | ✓ | ✓ |
| Same ecosystem parsers (lockfile / Dockerfile / workflow) | ✓ | ✓ |
| Same scanner logic (shared `@refuse/shared` package) | ✓ | ✓ |

The shared library means a CVE answer on OSS is the same answer on hosted — no fork.

## Tenancy + accounts

| Capability | OSS | Hosted |
| --- | --- | --- |
| API keys | ✓ (single tenant, minted via `REFUSE_ADMIN_TOKEN`) | ✓ (multi-tenant, via portal sign-up) |
| Per-account quotas | ✗ | ✓ (Free 100k / 30 days, Pro 5M / 30 days) |
| Per-account usage history | ✗ (your DB is your history) | ✓ (90 days, Workers Analytics Engine) |
| Billing | ✗ | ✓ (Pro tier — Coming soon) |

## Ops

| Capability | OSS | Hosted |
| --- | --- | --- |
| Pricing | $0 forever | $0 / 100k or $5/mo / 5M (Coming soon) |
| Container image | `ghcr.io/refusehq/refuse:latest` | n/a (Cloudflare Workers) |
| Cosign-signed releases | ✓ | n/a |
| SLSA provenance | ✓ | n/a |
| Support | GitHub Issues | Email support on Pro |
| SLA | none | best-effort on Pro |

## Roadmap items that flip the table

- **MCP transport on self-host** — once the OSS `/mcp` endpoint serves real traffic instead of 501, the "MCP transport" row above becomes ✓/✓.
- **Per-instance usage history on OSS** — a built-in events page for self-hosters who don't want to run their own observability stack.

## Hosted-only on purpose

These are managed-only and not planned for OSS:

- Per-tenant API key isolation, billing flow, customer portal, analytics-engine-backed usage history.
- Multi-tenant admin features under `app.refuse.dev` (account settings, billing portal, support contacts).

Everything else is fair game for the OSS edition. If you want a feature that's hosted-only today, open an issue.
