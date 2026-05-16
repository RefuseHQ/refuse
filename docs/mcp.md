# MCP

`refuse` exposes a Streamable HTTP MCP transport at `POST /mcp`. Six tools:

- `check_package` — vet a single (ecosystem, name, version)
- `batch_check` — many packages in parallel
- `check_lockfile` — parse + scan lockfile contents
- `check_dockerfile` — parse + scan a Dockerfile (base image + RUN lines)
- `check_workflow` — parse + scan GitHub Actions YAML
- `suggest_safe_version` — minimum-safe upgrade for an affected package

## Claude Code

`~/.claude/mcp.json` (or any project-local equivalent):

```json
{
  "mcpServers": {
    "refuse": {
      "url": "http://localhost:8080/mcp"
    }
  }
}
```

If you set `REFUSE_REQUIRE_KEY=true`:

```json
{
  "mcpServers": {
    "refuse": {
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer rfs_..." }
    }
  }
}
```

## Cursor

`~/.cursor/mcp.json` (or per-project):

```json
{
  "mcpServers": {
    "refuse": {
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer rfs_..." }
    }
  }
}
```

## Codex CLI

```sh
codex mcp add refuse http://localhost:8080/mcp
```

## Antigravity

Antigravity uses `serverUrl` rather than `url`:

```json
{
  "mcpServers": {
    "refuse": {
      "serverUrl": "http://localhost:8080/mcp"
    }
  }
}
```
