import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { AuthVariables } from '../auth/middleware.js'
import { requireProject } from '../auth/middleware.js'
import type { SseBroker } from '../stream/sse.js'
import type { ProjectRegistry } from '../tenancy/registry.js'

const HEARTBEAT_MS = 15_000

export function streamApi(
  registry: ProjectRegistry,
  broker: SseBroker,
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireProject(registry, 'read'))

  app.get('/stream/spans', (c) => {
    const { project } = c.get('auth')
    return streamSSE(c, async (stream) => {
      const emitter = broker.emitterFor(project.id)
      let id = 0
      const onBatch = (batch: unknown) => {
        void stream.writeSSE({
          event: 'spans',
          id: String(++id),
          data: JSON.stringify(batch),
        })
      }
      emitter.on('spans', onBatch)
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'heartbeat', data: 'ok' })
      }, HEARTBEAT_MS)
      const onAbort = () => {
        clearInterval(heartbeat)
        emitter.off('spans', onBatch)
      }
      c.req.raw.signal?.addEventListener?.('abort', onAbort)
      try {
        // Keep the stream alive until client disconnects.
        await new Promise<void>((resolve) => {
          c.req.raw.signal?.addEventListener?.('abort', () => resolve())
        })
      } finally {
        onAbort()
      }
    })
  })

  app.get('/stream/logs', (c) => {
    const { project } = c.get('auth')
    return streamSSE(c, async (stream) => {
      const emitter = broker.emitterFor(project.id)
      let id = 0
      const onBatch = (batch: unknown) => {
        void stream.writeSSE({
          event: 'logs',
          id: String(++id),
          data: JSON.stringify(batch),
        })
      }
      emitter.on('logs', onBatch)
      const heartbeat = setInterval(() => {
        void stream.writeSSE({ event: 'heartbeat', data: 'ok' })
      }, HEARTBEAT_MS)
      const onAbort = () => {
        clearInterval(heartbeat)
        emitter.off('logs', onBatch)
      }
      c.req.raw.signal?.addEventListener?.('abort', onAbort)
      try {
        await new Promise<void>((resolve) => {
          c.req.raw.signal?.addEventListener?.('abort', () => resolve())
        })
      } finally {
        onAbort()
      }
    })
  })

  return app
}
