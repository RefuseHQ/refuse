# syntax=docker/dockerfile:1.7
#
# Multi-stage build:
#   1. build  — install pnpm deps, native-compile better-sqlite3, compile TS
#   2. runtime — slim Node, only what's needed at runtime
#
# Goal: image < 250 MB unpacked, cold start < 1s with a populated DB.

# ─── 1. build ──────────────────────────────────────────────────────────────
FROM node:25-bookworm-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Copy lockfile + manifests first so dep install is cacheable.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json     apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/versions/package.json packages/versions/package.json
RUN pnpm install --frozen-lockfile

# Copy source + tsconfigs.
COPY tsconfig.base.json ./
COPY apps/server     apps/server
COPY packages        packages

RUN pnpm --filter @refuse-oss/server build

# ─── 2. runtime ────────────────────────────────────────────────────────────
FROM node:25-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bring across the compiled server + native better-sqlite3 binary + runtime
# deps. We re-install with --prod so devDependencies (tsx, vitest, types) get
# dropped from the final image.
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/versions/package.json packages/versions/package.json
# better-sqlite3 prebuild-install may fall back to source compile when no
# prebuilt binary matches the current Node ABI. Pull in build tools just
# long enough to install prod deps, then purge them in the same layer so
# the final runtime image stays slim.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ \
    && corepack enable && pnpm install --prod --frozen-lockfile \
    && apt-get purge -y --auto-remove python3 make g++ \
    && rm -rf /var/lib/apt/lists/* /root/.cache /root/.local

COPY --from=build /app/apps/server/dist            apps/server/dist
COPY --from=build /app/apps/server/src/migrations  apps/server/dist/migrations
COPY --from=build /app/apps/server/src/ui/static   apps/server/dist/ui/static
COPY --from=build /app/packages/shared             packages/shared
COPY --from=build /app/packages/versions           packages/versions

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production \
    REFUSE_DB_PATH=/data/refuse.db \
    REFUSE_PORT=8080

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.REFUSE_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini","--","/entrypoint.sh"]
CMD ["node","apps/server/dist/index.js"]
