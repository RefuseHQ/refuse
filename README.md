# refuse

Self-hostable server that vets packages before your AI coding agent installs them.

`refuse` is an MCP server + REST API + scheduled ingestion stack that pulls vulnerability and metadata feeds (OSV, deps.dev, CISA KEV, EPSS, GitHub Security Advisories, Wolfi) into a local SQLite database and answers questions like "is `lodash@4.17.10` vulnerable?" or "what's the minimum safe upgrade for `requests`?"

Pair it with the [`refuse` CLI](https://github.com/RefuseHQ/refuse-cli) for PATH-shim and agent-hook integration.

## Quickstart

```sh
docker run --rm -p 8080:8080 -v "$PWD/data:/data" ghcr.io/refusehq/refuse:latest
```

First boot pulls a fresh OSV snapshot (~2–3 minutes); after that the server answers queries from local SQLite.

- `GET  http://localhost:8080/healthz` — liveness
- `POST http://localhost:8080/api/v1/check/package` — REST API
- `POST http://localhost:8080/mcp` — MCP Streamable HTTP endpoint
- `http://localhost:8080/ui/` — built-in dashboard + playground

## Configuration

All env-driven. See [`docs/configuration.md`](docs/configuration.md) for the full reference.

Defaults are picked so `docker run` Just Works: anonymous access, SQLite at `/data/refuse.db`, in-process cron pulling public sources every few minutes.

## Compose

```yaml
services:
  refuse:
    image: ghcr.io/refusehq/refuse:latest
    ports: ["8080:8080"]
    volumes: ["./data:/data"]
    restart: unless-stopped
```

For a setup that requires API keys, see [`docker/docker-compose.with-key.yml`](docker/docker-compose.with-key.yml).

## Status

This is an open-source edition of a tool that also runs hosted at refuse.dev. See [DIVERGENCE.md](DIVERGENCE.md) for how the two relate.

## Licence

Apache-2.0 — see [LICENSE](LICENSE).
