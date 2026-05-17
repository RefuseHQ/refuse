#!/usr/bin/env bash
# Repo-hygiene audit. Fails the build on:
#   * vendor-locked URLs / domains that don't belong in a self-hostable server
#   * env-var names tied to a closed-source auth / billing stack
#   * code-level references to a private upstream
#   * Cloudflare Workers bindings (this is a Node server, not a Worker)
#   * package.json deps that pull in closed-source SaaS clients

set -euo pipefail

cd "$(dirname "$0")/.."

fail=0

note() { printf "\n\033[1m== %s ==\033[0m\n" "$*"; }
hits() {
  # $1 = label, rest = grep args
  local label="$1"; shift
  local out
  if out="$(grep "$@" 2>/dev/null)"; then
    printf "\033[31m[FAIL]\033[0m %s — matches:\n%s\n" "$label" "$out"
    fail=1
  else
    printf "\033[32m[ ok ]\033[0m %s\n" "$label"
  fi
}

INCLUDE=(--include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.json' --include='*.md' --include='*.sql' --include='*.yml' --include='*.yaml' --include='Dockerfile')
EXCLUDE=(--exclude-dir=node_modules --exclude-dir=dist --exclude-dir=data --exclude-dir=.git)

note "closed-source SaaS client SDKs (must be zero)"
hits "no workos / dodopayments / stripe / authkit references" \
  -rnE "workos|dodopayments|stripe|authkit" \
  "${INCLUDE[@]}" "${EXCLUDE[@]}" .

note "closed-source env-var names (must be zero)"
hits "no WORKOS_ / DODO_ / STRIPE_ / ADMIN_EMAILS / CARDS_NAMESPACE" \
  -rnE "WORKOS_|DODO_|STRIPE_|ADMIN_EMAILS|CARDS_NAMESPACE" \
  "${INCLUDE[@]}" "${EXCLUDE[@]}" .

note "private upstream path refs (must be zero)"
hits "no backend/apps/ or RefuseHQ/core" \
  -rnE "backend/apps/|RefuseHQ/core" \
  --include='*.ts' --include='*.md' "${EXCLUDE[@]}" .

note "Cloudflare Workers bindings (this is a Node server — must be zero)"
hits "no env.DB / env.CARDS / env.KV / ctx.waitUntil / wrangler" \
  -rnE "env\.DB|env\.CARDS|env\.KV|ctx\.waitUntil|wrangler" \
  --include='*.ts' --include='*.toml' "${EXCLUDE[@]}" .

note "package.json deps (must not include hosted-only SaaS clients)"
if command -v jq >/dev/null 2>&1; then
  bad=$(find . -name package.json -not -path '*/node_modules/*' -print0 \
    | xargs -0 -n1 jq -r '[.dependencies // {}, .devDependencies // {}] | .[] | keys[]' 2>/dev/null \
    | grep -E "workos|dodo|stripe|wrangler|@cloudflare" || true)
  if [ -n "$bad" ]; then
    printf "\033[31m[FAIL]\033[0m forbidden deps:\n%s\n" "$bad"
    fail=1
  else
    printf "\033[32m[ ok ]\033[0m no forbidden deps\n"
  fi
else
  printf "\033[33m[skip]\033[0m jq not installed; skipping dep audit\n"
fi

if [ "$fail" -ne 0 ]; then
  printf "\n\033[1;31mAUDIT FAILED — fix the FAIL lines above before publishing.\033[0m\n"
  exit 1
fi

printf "\n\033[1;32mAudit clean.\033[0m\n"
