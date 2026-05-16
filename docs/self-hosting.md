# Self-hosting refuse

## Minimum

```sh
docker run --rm -p 8080:8080 -v "$PWD/data:/data" ghcr.io/refusehq/refuse:latest
```

First boot pulls an OSV snapshot (~2–3 minutes); after that the server answers queries from the local SQLite file under `./data/`.

## Docker Compose

```yaml
services:
  refuse:
    image: ghcr.io/refusehq/refuse:latest
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:8080/healthz').then(r=>process.exit(r.ok?0:1))"]
      interval: 30s
      retries: 3
```

## Requiring API keys

Set `REFUSE_REQUIRE_KEY=true` and pick an admin token:

```yaml
environment:
  REFUSE_REQUIRE_KEY: "true"
  REFUSE_ADMIN_TOKEN: "<long-random-token>"
```

Then create keys via the embedded UI at `/ui/keys` (paste the admin token when prompted), or via the REST API:

```sh
curl -X POST http://localhost:8080/api/keys \
  -H "Authorization: Bearer $REFUSE_ADMIN_TOKEN" \
  -d '{"name":"laptop"}'
```

Keys start with `rfs_` and are shown once — copy on creation.

## Endpoints

- `GET  /healthz` — liveness
- `POST /mcp` — MCP Streamable HTTP transport (point Claude Code / Cursor here)
- `POST /api/v1/check/package` — REST API (see [api.md](api.md))
- `GET  /ui/` — embedded dashboard

## Storage

SQLite at `${REFUSE_DB_PATH:-/data/refuse.db}` with WAL mode. Back it up with `cp` while the server is running — SQLite WAL means a hot copy is safe.

Database size after a full ingest is roughly 200–400 MB. The image plus DB plus a fortnight of logs comfortably fits in a 1 GB volume.

## Resource needs

- Single container, single Node process.
- ~150 MB RAM baseline; spikes to ~500 MB during OSV ingestion.
- 200 m CPU steady, 1 CPU during ingestion runs.
- Outbound network access to OSV (Google Cloud Storage), deps.dev, CISA KEV, EPSS, GitHub Security Advisories, Wolfi. No inbound dependencies on RefuseHQ.

## Air-gapped / read-only mirror

Pre-seed `/data/refuse.db` from a backup on a machine that has network access, then run with `REFUSE_DISABLE_INGEST=true`. The server will serve queries against the static DB without trying to refresh.
