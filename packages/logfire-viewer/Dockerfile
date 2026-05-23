# Multi-stage build for @pydantic/logfire-viewer.
#
# Build context MUST be the monorepo root, because the viewer is an npm
# workspace that depends on the shared `@pydantic/logfire-tooling-config`
# package and the root lockfile. Build from the repo root:
#
#   docker build -f packages/logfire-viewer/Dockerfile -t logfire-viewer .
#
# Or use the docker-compose.yml in this directory, which sets the context.

# ---------------------------------------------------------------------------
# Stage 1: install all workspace deps (incl. devDeps) and build the package.
# Native modules (better-sqlite3) compile in this stage.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS builder

# better-sqlite3 ships with prebuilt binaries for most node/glibc combos, but
# we install the toolchain anyway so a fallback compile from source works.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /repo

# Copy only the files needed for `npm install` first, so layer caching kicks
# in for dep installs when only sources change.
COPY package.json package-lock.json turbo.json ./
COPY packages/tooling-config/package.json packages/tooling-config/
COPY packages/logfire-api/package.json packages/logfire-api/
COPY packages/logfire-viewer/package.json packages/logfire-viewer/

# The lockfile references every workspace, so npm needs all of them present.
COPY packages/logfire/package.json packages/logfire/
COPY packages/logfire-browser/package.json packages/logfire-browser/
COPY packages/logfire-cf-workers/package.json packages/logfire-cf-workers/
COPY examples/cf-producer-worker/package.json examples/cf-producer-worker/
COPY examples/cf-tail-worker/package.json examples/cf-tail-worker/
COPY examples/cf-worker/package.json examples/cf-worker/
COPY examples/express/package.json examples/express/
COPY examples/nextjs/package.json examples/nextjs/
COPY examples/nextjs-client-side-instrumentation/package.json examples/nextjs-client-side-instrumentation/
COPY examples/node/package.json examples/node/

RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --no-fund

# Now copy the sources for the packages we actually build.
COPY packages/tooling-config ./packages/tooling-config
COPY packages/logfire-viewer ./packages/logfire-viewer

# Build the viewer (server bundle then SPA into dist/web/).
RUN npm run --workspace=@pydantic/logfire-viewer build

# Drop devDependencies from the root install so the next stage gets only
# runtime modules. `npm prune` respects workspaces in this repo layout.
RUN npm prune --omit=dev --workspaces --include-workspace-root

# ---------------------------------------------------------------------------
# Stage 2: runtime. Slim image with just node + the built artifacts +
# production node_modules (incl. better-sqlite3's prebuilt native binding).
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

# Run as the non-root `node` user that the official image provides.
WORKDIR /app

# Bundled output + the package.json (used for `version` lookup).
COPY --from=builder /repo/packages/logfire-viewer/dist ./dist
COPY --from=builder /repo/packages/logfire-viewer/package.json ./package.json
COPY --from=builder /repo/packages/logfire-viewer/README.md ./README.md

# Production node_modules from the hoisted root install.
COPY --from=builder /repo/node_modules ./node_modules

# Default config: listen on all interfaces (inside the container) and store
# data under /data so a single volume mount persists everything.
ENV NODE_ENV=production \
    LOGFIRE_VIEWER_HOST=0.0.0.0 \
    LOGFIRE_VIEWER_PORT=4318 \
    LOGFIRE_VIEWER_GRPC_PORT=4317 \
    LOGFIRE_VIEWER_DATA_DIR=/data

RUN mkdir -p /data && chown -R node:node /app /data
USER node

VOLUME ["/data"]
EXPOSE 4318 4317

# `node dist/cli.cjs` is the unified entry. With no args, it runs the server
# (`serve` is the default subcommand). Override at runtime to invoke admin
# subcommands, e.g. `docker run ... admin add-project demo`.
ENTRYPOINT ["node", "dist/cli.cjs"]
CMD []
