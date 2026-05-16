# REST API

All endpoints respond with JSON. `POST` only — no method other than `POST` and `OPTIONS` is accepted. Auth via `Authorization: Bearer <key>` when `REFUSE_REQUIRE_KEY=true`; otherwise no auth required.

## `/api/v1/check/package`

```sh
curl -X POST http://localhost:8080/api/v1/check/package \
  -H 'Content-Type: application/json' \
  -d '{"ecosystem":"npm","name":"lodash","version":"4.17.10"}'
```

Returns `vulnerable`, `vulnerabilities[]`, `suggested_fixes[]`, `freshness`, and `license` if known.

## `/api/v1/check/batch`

Body: `{ "packages": [{ "ecosystem", "name", "version" }, ...] }`. Returns a summary plus per-package results. Use this instead of N individual calls when scanning more than ~5 packages.

## `/api/v1/check/lockfile`

Body: `{ "filename": "package-lock.json", "content": "..." }`. Filename drives the parser; content is the lockfile bytes. Supports `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `requirements.txt`, `Cargo.lock`, `Gemfile.lock`, `go.sum`, `composer.lock`, `pom.xml`, `*.csproj`, `mix.lock`, `pubspec.lock`.

## `/api/v1/check/dockerfile`

Body: `{ "content": "<Dockerfile bytes>", "detected_distro": "Debian:12" }` (the hint is optional). Parses base image and `RUN` lines; scans both distro packages and any language packages installed inside the image.

## `/api/v1/check/workflow`

Body: `{ "content": "<workflow YAML>" }`. Scans `uses:` entries in GitHub Actions workflows.

## `/api/v1/suggest-safe-version`

Body: `{ "ecosystem", "name", "current_version" }`. The current version is optional — without it, returns latest_stable / latest. With it, returns the minimum upgrade that escapes all matching advisories.

## Errors

- `400` — malformed body or missing required fields
- `401` — `REFUSE_REQUIRE_KEY=true` and the bearer token is missing/invalid
- `405` — non-POST method
- `500` — internal error (the body has `{ error: "..." }`)
