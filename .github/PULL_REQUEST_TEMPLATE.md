<!--
Thanks for opening a PR. A few things to make review fast:

- One logical change per PR. If you're tempted to write "and also", split it.
- Reference the issue you're closing: `Closes #N`.
- New features need a test; bug fixes need a regression test.
- CI must be green (typecheck, test, build, audit, docker).
-->

## What

<!-- A one-paragraph summary of what this PR does. -->

## Why

<!-- The motivation. Link to the issue, advisory, or upstream change that prompted it. -->

Closes #

## How

<!-- Implementation notes for the reviewer. Skip if obvious from the diff. -->

## Test plan

<!-- What did you do to verify this works? `pnpm test` passing is necessary but rarely sufficient. -->

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes
- [ ] `pnpm build` succeeds
- [ ] Manually verified with `curl` / browser / agent

## Checklist

- [ ] Added or updated tests
- [ ] Updated `docs/` if user-facing behavior changed
- [ ] Updated `CHANGELOG.md` under `[Unreleased]`
- [ ] No new vendor-locked dependencies (`./scripts/audit.sh` passes)
