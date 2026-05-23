# @pydantic/logfire-viewer

A self-hosted local server and web UI for ingesting and analyzing OpenTelemetry
data — a mini Logfire backend you can run on your laptop. Point any
OpenTelemetry SDK (including [`logfire`](../logfire)) at it and browse the
collected traces, logs, and metrics in a browser.

## Highlights

- **OTLP receivers**: HTTP (`/v1/traces`, `/v1/logs`, `/v1/metrics`) over
  protobuf or JSON, plus a gRPC receiver on the OTel standard port.
- **Storage**: SQLite (better-sqlite3) with WAL, JSON1, and FTS5 for full-text
  search.
- **Multi-tenant**: token-based authentication; each project is an isolated
  database file.
- **Real-time**: Server-Sent Events stream new spans and logs to the UI.
- **Analysis**: trace tree waterfall, filter & full-text search, aggregations
  dashboard, ad-hoc read-only SQL editor.
- **Ops**: configurable per-project retention (age + max rows), ingest
  rate-limiting, head sampling.

## Quick start

```sh
# Install (from a release; or `npm run build` from a checkout)
npm install -g @pydantic/logfire-viewer

# Initialize the admin DB. Prints the admin token — save it!
logfire-viewer admin init --data-dir ./logfire-data

# Create a project and a write token
logfire-viewer admin add-project demo --data-dir ./logfire-data
logfire-viewer admin add-token --project demo --data-dir ./logfire-data

# Start the server (HTTP :4318, gRPC :4317)
logfire-viewer --data-dir ./logfire-data
```

Now point any OTLP-emitting code at it. Using the `logfire` SDK in this repo:

```sh
LOGFIRE_TOKEN=<project-token> \
LOGFIRE_SEND_TO_LOGFIRE=true \
LOGFIRE_BASE_URL=http://localhost:4318 \
node your-app.js
```

Open <http://localhost:4318> and log in with the project token to browse data.

## Docker

A `Dockerfile` and `docker-compose.yml` ship with the package. Both expect
the **monorepo root** as the build context.

```sh
# From the monorepo root:
docker compose -f packages/logfire-viewer/docker-compose.yml up -d --build

# Read the admin token from the first-start logs:
docker compose -f packages/logfire-viewer/docker-compose.yml logs viewer

# Create a project + a project token:
docker compose -f packages/logfire-viewer/docker-compose.yml exec viewer \
  node dist/cli.cjs admin add-project demo
docker compose -f packages/logfire-viewer/docker-compose.yml exec viewer \
  node dist/cli.cjs admin add-token --project demo --name my-app
```

Or without compose:

```sh
docker build -f packages/logfire-viewer/Dockerfile -t logfire-viewer .
docker run --rm -p 4318:4318 -p 4317:4317 -v logfire-data:/data logfire-viewer
```

The container listens on `0.0.0.0:4318` (HTTP/OTLP + UI) and `0.0.0.0:4317`
(gRPC). Data is persisted to the `/data` volume. The same image runs
admin subcommands — pass them as the container args, e.g.
`docker run ... logfire-viewer admin add-project demo`.

## CLI

```
logfire-viewer [command] [options]

Commands:
  serve (default)                    Run the server
  admin init                         Initialize admin DB, print admin token
  admin reset-token                  Re-roll admin token
  admin add-project <slug>           Create a project
  admin add-token --project <slug>   Create a project token

Server options:
  --port <n>            HTTP port (default 4318)
  --grpc-port <n>       gRPC port (default 4317)
  --no-grpc             Disable gRPC receiver
  --host <h>            Bind host (default 127.0.0.1)
  --data-dir <path>     Directory for admin + per-project DBs (default ./logfire-data)
  --max-rps <n>         Global ingest rate ceiling (default unlimited)
  --no-retention        Disable the retention sweeper
```

Environment variables: `LOGFIRE_VIEWER_PORT`, `LOGFIRE_VIEWER_GRPC_PORT`,
`LOGFIRE_VIEWER_HOST`, `LOGFIRE_VIEWER_DATA_DIR`, `LOGFIRE_VIEWER_MAX_RPS`,
`LOGFIRE_VIEWER_RETENTION` (`0` to disable),
`LOGFIRE_VIEWER_RETENTION_INTERVAL_MS`, `LOGFIRE_VIEWER_GRPC` (`0` to disable).

## Programmatic use

```ts
import { startViewer } from '@pydantic/logfire-viewer'

const { httpUrl, grpcUrl, close } = await startViewer({
  dataDir: './logfire-data',
  port: 4318,
  grpcPort: 4317,
})

// ... later
await close()
```

## Status

This is a young package — feature scope is wide but rough edges remain. Not
intended as a drop-in replacement for the hosted Logfire backend. For
production observability use [Logfire Cloud](https://pydantic.dev/logfire).
