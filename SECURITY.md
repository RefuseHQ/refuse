# Security Policy

## Reporting a vulnerability

If you've found a security issue in refuse — please report it privately. Public disclosure of an unpatched issue puts every operator of this server at risk.

**Email:** [hello@refuse.dev](mailto:hello@refuse.dev) with the subject line `[security] <short description>`.

Alternatively, use GitHub's [private vulnerability reporting](https://github.com/RefuseHQ/refuse/security/advisories/new) on this repository.

Please include:

- A description of the issue and its impact.
- Steps to reproduce, or a minimal proof-of-concept.
- The version (`refuse --version` output, or the Docker image SHA / tag) you tested against.
- Any suggested fix, if you have one.

We aim to acknowledge reports within **48 hours** and to publish a fix or a mitigation plan within **90 days** for most issues. Critical issues (RCE, auth bypass, data exposure) are prioritized.

Please do not:

- File public issues for security problems.
- Test against infrastructure you don't own — public mirrors, anyone else's self-hosted instance, hosted services.
- Use automated scanners that generate noise without verification.

## Supported versions

refuse is pre-1.0. We currently support security fixes only on the **latest tagged release** and `main`. Once we ship 1.0 we'll publish an LTS policy.

## What's in scope

- The HTTP server in `apps/server/` (auth, input validation, SQL handling, command injection, SSRF in ingest paths).
- The vulnerability ingest pipeline (`apps/server/src/ingest/`) — particularly anything that could let a malicious upstream feed poison the local database.
- The Docker image build (`docker/Dockerfile`) and entrypoint.
- The published `ghcr.io/refusehq/refuse` container.
- The admin UI (`apps/server/src/ui/`).

## What's out of scope

- Reports against unsupported configurations (e.g., running the server behind an open-to-the-internet admin token).
- Self-XSS that requires the user to paste attacker-controlled input into their own browser console.
- Issues in third-party dependencies that don't affect refuse's behavior. (Open a PR bumping the dep instead.)
- Reports without a reproducer.

## Disclosure

Once a fix is shipped, we publish a [GitHub Security Advisory](https://github.com/RefuseHQ/refuse/security/advisories) with a CVE where appropriate. Reporters are credited unless they ask to be anonymous.

Thank you for helping keep refuse, and the people who run it, safe.

## Verifying releases

Container images and release artifacts are signed with [cosign](https://github.com/sigstore/cosign) using GitHub OIDC (keyless) and published with [SLSA](https://slsa.dev) provenance.

To verify the container image:

```bash
cosign verify ghcr.io/refusehq/refuse:latest \
  --certificate-identity-regexp 'https://github.com/RefuseHQ/refuse/.github/workflows/release.yaml.*' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

To verify SLSA provenance with [slsa-verifier](https://github.com/slsa-framework/slsa-verifier):

```bash
slsa-verifier verify-image ghcr.io/refusehq/refuse:latest \
  --source-uri github.com/RefuseHQ/refuse
```

If verification fails, do not use the image. Open a security advisory.
