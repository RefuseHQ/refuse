# Configuration

All env-driven. Validated at boot with `zod`; unknown `REFUSE_*` vars produce a startup warning.

| Env | Default | Purpose |
|---|---|---|
| `REFUSE_PORT` | `8080` | HTTP listen port |
| `REFUSE_DB_PATH` | `/data/refuse.db` | SQLite file path; parent must be writable |
| `REFUSE_REQUIRE_KEY` | `false` | When `true`, `/mcp` and `/api/v1/check/*` require an API key |
| `REFUSE_ADMIN_TOKEN` | *(unset)* | Static bearer for admin UI + key CRUD; unset disables admin |
| `REFUSE_OSV_FREQUENCY` | `5` | Minutes between OSV delta runs |
| `REFUSE_DEPS_DEV_FREQUENCY` | `15` | Minutes between deps.dev runs |
| `REFUSE_ENRICHMENT_CRON` | `0 5 * * *` | Cron expression for daily KEV/EPSS/GHSA/Wolfi enrichment |
| `REFUSE_BOOTSTRAP_ON_EMPTY` | `true` | On empty DB, kick a synchronous OSV pass to populate it |
| `REFUSE_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `REFUSE_GITHUB_TOKEN` | *(unset)* | Raises GHSA ingestion rate limits (optional) |
| `REFUSE_DISABLE_INGEST` | `false` | Read-only mirror mode — for pre-seeded `/data` snapshots |
| `REFUSE_CARD_CACHE_SIZE` | `5000` | LRU entries for built cards |
| `REFUSE_CARD_CACHE_TTL_SECONDS` | `600` | TTL for cards LRU |
| `REFUSE_CORS_ORIGIN` | `*` | CORS allow-origin on `/api/v1/check/*` |

## Sensible production setup

```sh
REFUSE_REQUIRE_KEY=true
REFUSE_ADMIN_TOKEN=<32+ random chars>
REFUSE_GITHUB_TOKEN=<personal access token, public repos only>
REFUSE_CORS_ORIGIN=https://your-internal-app.example.com
```

## Air-gapped

```sh
REFUSE_DISABLE_INGEST=true
REFUSE_BOOTSTRAP_ON_EMPTY=false
```

Then mount a pre-seeded `refuse.db` at `${REFUSE_DB_PATH}`.
