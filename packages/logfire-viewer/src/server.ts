import { serve } from '@hono/node-server'
import * as grpc from '@grpc/grpc-js'
import type Database from 'better-sqlite3'
import { Hono } from 'hono'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { adminApi } from './api/admin.js'
import { logsApi } from './api/logs.js'
import { metricsApi } from './api/metrics.js'
import { queryApi } from './api/query.js'
import { spansApi } from './api/spans.js'
import { statsApi } from './api/stats.js'
import { streamApi } from './api/stream.js'
import { generateToken } from './auth/tokens.js'
import { openAdminDb } from './db/index.js'
import { buildGrpcServer } from './ingest/grpc.js'
import { ingestApi } from './ingest/http.js'
import { TokenBucketLimiter } from './ratelimit/tokenBucket.js'
import { startRetentionLoop, type RetentionLoop } from './retention/sweeper.js'
import { staticApp } from './static.js'
import { SseBroker } from './stream/sse.js'
import { listProjects, setSetting } from './tenancy/projects.js'
import { ProjectRegistry } from './tenancy/registry.js'
import type {
  ResolvedViewerOptions,
  ViewerHandle,
  ViewerOptions,
} from './types.js'

const here = dirname(fileURLToPath(import.meta.url))

function resolveOptions(opts: ViewerOptions): ResolvedViewerOptions {
  const env = process.env
  return {
    dataDir: resolve(opts.dataDir ?? env.LOGFIRE_VIEWER_DATA_DIR ?? './logfire-data'),
    port: opts.port ?? Number(env.LOGFIRE_VIEWER_PORT ?? 4318),
    grpcPort: opts.grpcPort ?? Number(env.LOGFIRE_VIEWER_GRPC_PORT ?? 4317),
    host: opts.host ?? env.LOGFIRE_VIEWER_HOST ?? '127.0.0.1',
    enableGrpc:
      opts.enableGrpc ?? env.LOGFIRE_VIEWER_GRPC !== '0',
    enableRetention:
      opts.enableRetention ?? env.LOGFIRE_VIEWER_RETENTION !== '0',
    retentionIntervalMs:
      opts.retentionIntervalMs ?? Number(env.LOGFIRE_VIEWER_RETENTION_INTERVAL_MS ?? 60_000),
    maxRps: opts.maxRps ?? Number(env.LOGFIRE_VIEWER_MAX_RPS ?? 0),
  }
}

function findWebRoot(): string {
  const candidates = [
    join(here, 'web'),
    join(here, '..', 'web'),
    join(here, '..', '..', 'dist', 'web'),
    join(here, '..', '..', 'web'),
  ]
  return candidates[0]!
}

export interface BuildAppResult {
  app: Hono
  registry: ProjectRegistry
  broker: SseBroker
  limiter: TokenBucketLimiter
  adminDb: Database.Database
}

function ensureAdminToken(adminDb: Database.Database, log: (msg: string) => void): void {
  const existing = adminDb
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('admin_token_hash') as { value: string } | undefined
  if (existing) return
  const { plaintext, storedHash } = generateToken()
  setSetting(adminDb, 'admin_token_hash', storedHash)
  log('====================================================================')
  log(' Logfire viewer initialized — save this admin token, it is shown once:')
  log(`   ${plaintext}`)
  log('====================================================================')
}

export function buildApp(
  options: ResolvedViewerOptions,
  log: (msg: string) => void = (msg) => console.log(msg),
): BuildAppResult {
  const adminDb = openAdminDb(options.dataDir)
  ensureAdminToken(adminDb, log)
  const registry = new ProjectRegistry(adminDb)
  registry.warmAll(listProjects(adminDb))
  const broker = new SseBroker()
  const limiter = new TokenBucketLimiter(options.maxRps > 0 ? options.maxRps : null)

  const app = new Hono()

  app.get('/healthz', (c) => c.json({ ok: true, version: getVersion() }))

  app.route('/v1', ingestApi(registry, broker, limiter))
  // Admin routes must be mounted before the generic `/api/*` routes so that
  // requests under `/api/admin/...` resolve admin auth instead of falling
  // through to project-token middleware.
  app.route('/api/admin', adminApi(adminDb, registry, options.dataDir))
  app.route('/api', spansApi(registry))
  app.route('/api', logsApi(registry))
  app.route('/api', metricsApi(registry))
  app.route('/api', statsApi(registry))
  app.route('/api', queryApi(registry))
  app.route('/api', streamApi(registry, broker))
  app.route('/', staticApp(findWebRoot()))

  return { app, registry, broker, limiter, adminDb }
}

declare const PACKAGE_VERSION: string

function getVersion(): string {
  try {
    return typeof PACKAGE_VERSION === 'string' ? PACKAGE_VERSION : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export async function startViewer(opts: ViewerOptions = {}): Promise<ViewerHandle> {
  const options = resolveOptions(opts)
  const log = (msg: string): void => {
    console.log(msg)
  }
  const { app, registry, broker, adminDb } = buildApp(options, log)

  const httpServer = serve({
    fetch: app.fetch,
    hostname: options.host,
    port: options.port,
  })
  log(`HTTP listening on http://${options.host}:${options.port}`)

  let grpcServer: grpc.Server | null = null
  let grpcUrl: string | null = null
  if (options.enableGrpc) {
    grpcServer = buildGrpcServer(registry, broker, new TokenBucketLimiter(null))
    await new Promise<void>((resolveBind, rejectBind) => {
      grpcServer!.bindAsync(
        `${options.host}:${options.grpcPort}`,
        grpc.ServerCredentials.createInsecure(),
        (err) => {
          if (err) rejectBind(err)
          else resolveBind()
        },
      )
    })
    grpcUrl = `${options.host}:${options.grpcPort}`
    log(`gRPC listening on ${grpcUrl}`)
  }

  let retention: RetentionLoop | null = null
  if (options.enableRetention) {
    retention = startRetentionLoop(registry, options.retentionIntervalMs)
  }

  const close = async (): Promise<void> => {
    retention?.stop()
    if (grpcServer) {
      await new Promise<void>((res) => {
        grpcServer!.tryShutdown(() => res())
      })
    }
    await new Promise<void>((res) => {
      httpServer.close(() => res())
    })
    registry.close()
    broker.close()
    adminDb.close()
  }

  return {
    httpUrl: `http://${options.host}:${options.port}`,
    grpcUrl,
    close,
  }
}
