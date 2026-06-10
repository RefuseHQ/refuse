# Contributing to refuse

Thanks for considering a contribution — refuse is a young project and outside help moves it forward faster than anything else.

This document covers the **server** (`refuse`). For the CLI shim, see [`RefuseHQ/refuse-cli`](https://github.com/RefuseHQ/refuse-cli).

## Ways to help

- **Found a CVE we miss, or a false positive?** Open an issue with the package + version + what you expected. These are the most valuable reports we get.
- **A package manager or lockfile format we don't handle yet?** New parser PRs are very welcome — `apps/server/src/parsers/` is structured so each ecosystem is self-contained.
- **A new vulnerability data source?** See `apps/server/src/ingest/` for the existing OSV / deps.dev / KEV / EPSS / GHSA / Wolfi adapters.
- **Self-hosting feedback.** If something in the Docker setup or the docs tripped you up, please tell us. The bar is "60 seconds to first blocked install."
- **Anything in `docs/`.** Docs PRs are reviewed on the same day, usually.

## Development setup

Requirements:

- Node ≥ 20
- pnpm ≥ 10 (`corepack enable && corepack prepare pnpm@10.32.1 --activate`)
- Docker (optional, for the container build)
- SQLite is bundled via `better-sqlite3` — no system install needed

```sh
git clone https://github.com/RefuseHQ/refuse.git
cd refuse
pnpm install
pnpm typecheck     # strict TS, must pass
pnpm test          # vitest across all workspaces
pnpm build         # tsup bundle for the server
pnpm dev           # starts the server on :8080
```

Once the server is running:

```sh
curl http://localhost:8080/healthz
curl -X POST http://localhost:8080/api/v1/check/package \
  -H 'content-type: application/json' \
  -d '{"ecosystem":"npm","name":"lodash","version":"4.17.10"}'
```

The database lives in `./data/refuse.db` by default. Delete it and restart to re-seed from upstream feeds.

## Repo layout

```
apps/server/           # Hono HTTP server + scheduler + admin UI
  src/
    http/              # Routes, middleware, auth
    ingest/            # OSV, deps.dev, KEV, EPSS, GHSA, Wolfi adapters
    parsers/           # Lockfiles, Dockerfiles, GH Actions workflows
    db/                # SQLite migrations + queries
    ui/                # Embedded admin dashboard
packages/shared/       # Zod schemas, ecosystem normalization
packages/versions/     # Per-ecosystem version comparators
docker/                # Multi-stage Dockerfile + compose examples
docs/                  # User-facing documentation
scripts/audit.sh       # OSS-independence check (runs in CI)
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for a deeper walkthrough.

## Coding conventions

- **TypeScript strict.** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on. Don't reach for `any`; ask for review if a type is fighting you.
- **No ORM.** SQLite queries are written by hand against the `better-sqlite3` API, behind a thin facade in `apps/server/src/db/adapter.ts` so call sites stay terse.
- **Parsers are pure.** Lockfile/Dockerfile/workflow parsers take a string and return a `ParseResult` — no I/O, no logging. This keeps them trivially testable.
- **Tests live next to code.** `foo.ts` ↔ `foo.test.ts`. Vitest, `*.test.ts` files are picked up automatically.
- **Errors must be actionable.** A 500 with `internal error` helps no one — surface the failing source, the package, and what was attempted.
- **No vendor-locked code in `main`.** `scripts/audit.sh` runs in CI and rejects references to closed-source upstreams (WorkOS, Stripe, Dodo, etc.).

## Commit & PR style

- Conventional commits encouraged but not enforced (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
- One logical change per PR. If you find yourself writing "and also" in the description, it's two PRs.
- Reference the issue you're closing in the description (`Closes #42`).
- New features need a test. Bug fixes need a regression test.

CI runs typecheck → test → build → audit → docker build on every PR. All must pass before review.

## Adding a new ecosystem

If you want refuse to understand a package manager we don't currently support:

1. Add a version comparator in `packages/versions/src/<ecosystem>.ts` and tests in `<ecosystem>.test.ts`.
2. Register it in `packages/versions/src/index.ts`.
3. Add the ecosystem to `packages/shared/src/ecosystems.ts`.
4. If lockfiles need parsing, add `apps/server/src/parsers/lockfile/<ecosystem>.ts` and tests.
5. Update `docs/api.md` with the new ecosystem string.

PRs that add a new ecosystem and ship with tests have historically been merged within a day.

## Reporting security issues

Don't open a public issue. See [SECURITY.md](./SECURITY.md).

## Code of conduct

By participating you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).

## License

By contributing you agree your changes are licensed under [Apache License 2.0](./LICENSE).
