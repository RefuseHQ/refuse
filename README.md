# refuse

> Self-hostable server that vets packages before your AI coding agent installs them.

[![CI](https://github.com/RefuseHQ/refuse/actions/workflows/ci.yaml/badge.svg)](https://github.com/RefuseHQ/refuse/actions/workflows/ci.yaml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Container](https://img.shields.io/badge/ghcr.io%2Frefusehq%2Frefuse-latest-1f6feb?logo=docker)](https://github.com/RefuseHQ/refuse/pkgs/container/refuse)

`refuse` is an [MCP](https://modelcontextprotocol.io/) server + REST API + scheduled ingestion stack. It pulls vulnerability and metadata feeds — OSV, deps.dev, CISA KEV, FIRST EPSS, GitHub Security Advisories, Wolfi — into a local SQLite database and answers questions like:

- *Is `lodash@4.17.10` vulnerable?*
- *What's the minimum-safe upgrade for `requests`?*
- *Are any of the 250 packages in this `package-lock.json` known-bad?*
- *Does this Dockerfile install a CVE-laden apt package?*

It's the server side of the [refuse-cli](https://github.com/RefuseHQ/refuse-cli) shim and the open-source twin of the hosted service at [refuse.dev](https://refuse.dev). Same query layer, same MCP tools, same data sources — different runtime (Node + SQLite + node-cron instead of Cloudflare Workers + D1 + KV).

---

## Quickstart

```sh
docker run --rm -p 8080:8080 -v "$PWD/data:/data" ghcr.io/refusehq/refuse:latest
```

First boot pulls an OSV snapshot (~2–3 minutes). After that, queries run from local SQLite:

```sh
curl -s -X POST http://localhost:8080/api/v1/check/package \
  -H 'Content-Type: application/json' \
  -d '{"ecosystem":"npm","name":"lodash","version":"4.17.10"}' | jq .

# {
#   "vulnerable": true,
#   "package": "lodash",
#   "version": "4.17.10",
#   "vulnerabilities": [
#     { "cve": "CVE-2019-10744", "severity_label": "high", … }
#   ],
#   "suggested_fixes": [
#     { "version": "4.17.21", "type": "minimum_safe", "breaking_change": false }
#   ]
# }
```

Or browse to <http://localhost:8080/ui/> for the dashboard, an interactive playground, source health, and API-key management.

---

## What's in the box

- **HTTP/REST API** at `/api/v1/check/*` — same shape as the hosted refuse.dev API.
- **MCP server** at `/mcp` (Streamable HTTP transport) for Claude Code, Cursor, Codex, Antigravity, and any other MCP client.
- **Six tools** wired into both surfaces: `check_package`, `batch_check`, `check_lockfile`, `check_dockerfile`, `check_workflow`, `suggest_safe_version`.
- **In-process ingestion** via `node-cron`. Three jobs:
  - OSV delta every ~5 min (round-robin across ecosystems, configurable)
  - deps.dev refresh every ~15 min (latest stable + license per package)
  - Daily enrichment at 05:00 UTC — CISA KEV, EPSS, GHSA direct, Wolfi
- **Embedded SQLite** (better-sqlite3, WAL mode). One file, mounted from the host.
- **Optional API-key auth** — anonymous by default; flip a single env var to require bearer tokens.
- **Built-in admin UI** — vanilla HTML/JS, no build step, ~30 KB.
- **Reads only from public sources.** No dependency on the hosted refuse.dev infrastructure.

---

## How it fits

```
                                              ┌──────────────────────────────┐
   AI coding agent ─────── tool call ───────►   refuse-cli (PATH shim or
   (Claude Code, Cursor,                        hook into agent harness)
   Codex, …)                                  └──────┬───────────────────────┘
                                                     │  HTTP / MCP
                                                     ▼
                                              ┌──────────────────────────────┐
                                              │   refuse server (this repo)  │
                                              │                              │
                                              │  /api/v1/check/*   /mcp      │
                                              │       │                │     │
                                              │       └────┬───────────┘     │
                                              │            ▼                 │
                                              │   tool handlers  ─►  SQLite  │
                                              │                              │
                                              │   node-cron (in-process)     │
                                              │      ▲                       │
                                              └──────┼───────────────────────┘
                                                     │
                       ┌─────────────────────────────┼────────────────────────┐
                       │                             │                        │
                       ▼                             ▼                        ▼
                     OSV                         deps.dev               KEV / EPSS /
                  (all ecosystems)              (license + versions)   GHSA / Wolfi
```

You can point [refuse-cli](https://github.com/RefuseHQ/refuse-cli) at this server instead of the default hosted URL:

```sh
refuse config set server_url http://localhost:8080
```

…and the entire shim + hook integration runs against your self-hosted copy.

---

## Production deploy (compose)

```yaml
services:
  refuse:
    image: ghcr.io/refusehq/refuse:latest
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    restart: unless-stopped
    environment:
      REFUSE_REQUIRE_KEY: "true"
      REFUSE_ADMIN_TOKEN: "${REFUSE_ADMIN_TOKEN:?set it before starting}"
      # REFUSE_GITHUB_TOKEN: ghp_... (optional, raises GHSA ingest rate limit)
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1))"]
      interval: 30s
      retries: 3
```

See [`docker/docker-compose.with-key.yml`](docker/docker-compose.with-key.yml) for the same with comments.

---

## Configuration

Everything is env-driven. Defaults pick safe values so `docker run` works without any flags.

| Variable | Default | Purpose |
| --- | --- | --- |
| `REFUSE_PORT` | `8080` | HTTP listen port |
| `REFUSE_DB_PATH` | `/data/refuse.db` | SQLite file path |
| `REFUSE_REQUIRE_KEY` | `false` | Require `Authorization: Bearer rfs_…` on `/mcp` + `/api/v1/check/*` |
| `REFUSE_ADMIN_TOKEN` | *(unset)* | Static bearer for admin UI + key CRUD |
| `REFUSE_OSV_FREQUENCY` | `5` | Minutes between OSV delta runs |
| `REFUSE_DEPS_DEV_FREQUENCY` | `15` | Minutes between deps.dev runs |
| `REFUSE_ENRICHMENT_CRON` | `0 5 * * *` | Cron expression for KEV/EPSS/GHSA/Wolfi |
| `REFUSE_BOOTSTRAP_ON_EMPTY` | `true` | Synchronous OSV pull on first boot if DB is empty |
| `REFUSE_DISABLE_INGEST` | `false` | Read-only mirror mode (for pre-seeded snapshots) |
| `REFUSE_GITHUB_TOKEN` | *(unset)* | Optional GH token, only used to raise the GHSA-direct rate limit |
| `REFUSE_CARD_CACHE_SIZE` | `5000` | LRU entries for built `VulnCard`s |
| `REFUSE_CARD_CACHE_TTL_SECONDS` | `600` | TTL on that LRU |
| `REFUSE_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `REFUSE_CORS_ORIGIN` | `*` | CORS allow-origin on `/api/v1/check/*` |

Full reference: [`docs/configuration.md`](docs/configuration.md).

---

## API surface

| | |
| --- | --- |
| `GET  /healthz` | Liveness probe |
| `POST /mcp` | MCP Streamable HTTP — point Claude Code / Cursor here |
| `POST /api/v1/check/package` | Single-package vuln check |
| `POST /api/v1/check/batch` | Many packages in parallel |
| `POST /api/v1/check/lockfile` | Parse + scan an entire lockfile |
| `POST /api/v1/check/dockerfile` | Parse + scan base image + RUN lines |
| `POST /api/v1/check/workflow` | Scan GitHub Actions `uses:` entries |
| `POST /api/v1/suggest-safe-version` | Minimum-safe upgrade for an affected package |
| `GET  /api/admin/stats` | DB row counts (admin token) |
| `GET  /api/admin/sources` | Last-run / last-OK per ingest source |
| `POST /api/admin/ingest/{osv,deps-dev,enrichment}` | Manual trigger |
| `GET/POST/DELETE /api/keys[/:id]` | API key CRUD |
| `GET  /ui/` | Embedded admin UI |

Full schema reference: [`docs/api.md`](docs/api.md).

---

## How it compares

| | refuse | OSV-scanner | Trivy / Grype | Dependency-Track | guarddog | npq |
| --- | --- | --- | --- | --- | --- | --- |
| OSS license | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 | MIT |
| Standalone server | ✅ | — | partial | ✅ | — | — |
| MCP endpoint | ✅ | — | — | — | — | — |
| Agent pre-tool-use hook integration (via [`refuse-cli`](https://github.com/RefuseHQ/refuse-cli)) | ✅ | — | — | — | — | — |
| PATH-shim wrap of `npm install` etc. (via `refuse-cli`) | ✅ | — | — | — | — | ✅ |
| OSV data | ✅ | ✅ | ✅ | ✅ | — | — |
| KEV / EPSS enrichment | ✅ | — | partial | ✅ | — | — |
| Dockerfile RUN-line scanning | ✅ | — | ✅ | partial | — | — |
| GitHub Actions `uses:` scanning | ✅ | — | partial | — | — | — |
| Heuristic malicious-package detection | partial | — | — | — | ✅ | partial |
| Single-container deploy | ✅ | n/a | ✅ | ✅ | n/a | n/a |

Refuse's specific wedge is the **agent-native interface** — MCP for the model, a CLI shim + hook for the harness. If you already run Trivy or Dependency-Track for the lockfile/SBOM angle, refuse complements them rather than replaces; the structured refusal records (package, version, reason, OSV id) drop into either pipeline.

---

## Self-host walkthrough

1. **Spin it up.**

   ```sh
   docker run --rm -p 8080:8080 -v "$PWD/data:/data" ghcr.io/refusehq/refuse:latest
   ```

2. **Wait for the bootstrap pull.** Watch `docker logs` — the first OSV pass takes ~2–3 minutes. After it finishes, `curl localhost:8080/healthz` returns `{"status":"ok"}` and `/api/admin/sources` shows non-zero records.

3. **Optional: lock it down.** Set `REFUSE_REQUIRE_KEY=true` and `REFUSE_ADMIN_TOKEN=<long random string>`. Open `http://localhost:8080/ui/keys`, paste the admin token, create a key (it's shown once).

4. **Point your client at it.**

   - **refuse-cli:** `refuse config set server_url http://your-server:8080`
   - **Claude Code:** edit `~/.claude/mcp.json` → `"url": "http://your-server:8080/mcp"` (+ Authorization header if you required a key)
   - **Anything HTTP:** `POST http://your-server:8080/api/v1/check/package`

5. **(Optional) Pre-seed for air-gapped.** Copy a populated `refuse.db` from a network-attached host, mount it as `/data/refuse.db`, then set `REFUSE_DISABLE_INGEST=true`.

Detailed guide: [`docs/self-hosting.md`](docs/self-hosting.md).

---

## Build from source

```sh
git clone https://github.com/RefuseHQ/refuse.git
cd refuse
pnpm install
pnpm typecheck && pnpm test
pnpm --filter @refuse-oss/server dev      # hot reload on src/

# build the Docker image locally
make docker
make docker-run                            # → http://localhost:8080
```

Layout:

```
apps/server/             # Hono server, MCP transport, tools, ingest, UI
  src/
    config.ts            # env validation
    db/                  # SQLite client + D1-shape facade + migrations
    http/                # router, REST, auth, admin
    mcp/                 # MCP Streamable HTTP transport
    tools/               # the six check_* tools
    ingest/              # cron scheduler + OSV/deps.dev/KEV/EPSS/GHSA/Wolfi
    cards/               # VulnCard reader (LRU on top of SQLite)
    ui/static/           # tiny vanilla SPA
packages/
  shared/                # zod schemas, ecosystem normalization
  versions/              # version matchers (semver, pypi, maven, dpkg, …)
docker/                  # Dockerfile + compose examples + entrypoint
```

---

## Project status

Alpha. The query/REST surface is feature-complete and verified end-to-end; the MCP transport endpoint at `/mcp` is currently a stub returning 501 — it will be wired up before tagging `v0.1.0`. Track progress in the [issues](https://github.com/RefuseHQ/refuse/issues).

---

## Contributing

Issues, fixes, and new ecosystem matchers are welcome. Before opening a PR:

```sh
pnpm typecheck && pnpm test
./scripts/audit.sh        # makes sure nothing references hosted-refuse infra
make docker               # confirms the image still builds
```

See [`DIVERGENCE.md`](DIVERGENCE.md) for how this repo stays in sync with the hosted edition.

---

## Acknowledgments

Built on top of [OSV.dev](https://osv.dev/), [deps.dev](https://deps.dev/), the [CISA KEV catalog](https://www.cisa.gov/known-exploited-vulnerabilities-catalog), [FIRST EPSS](https://www.first.org/epss/), [GitHub Security Advisories](https://github.com/advisories), and the [Wolfi advisories](https://github.com/wolfi-dev/advisories). All free, all maintained by people doing the real work — refuse is mostly plumbing on top of theirs.

---

## License

[Apache-2.0](LICENSE).
