import { EventEmitter } from 'node:events'

import type { ApiLog, ApiSpan } from '../types.js'

export interface SseEvents {
  spans: ApiSpan[]
  logs: ApiLog[]
  metrics: { stream_id: string; time_ms: number; value: number | null }[]
}

export class SseBroker {
  private emitters = new Map<string, EventEmitter>()

  emitterFor(projectId: string): EventEmitter {
    let e = this.emitters.get(projectId)
    if (!e) {
      e = new EventEmitter()
      e.setMaxListeners(0)
      this.emitters.set(projectId, e)
    }
    return e
  }

  publishSpans(projectId: string, batch: ApiSpan[]): void {
    if (batch.length === 0) return
    this.emitterFor(projectId).emit('spans', batch)
  }

  publishLogs(projectId: string, batch: ApiLog[]): void {
    if (batch.length === 0) return
    this.emitterFor(projectId).emit('logs', batch)
  }

  publishMetrics(projectId: string, batch: SseEvents['metrics']): void {
    if (batch.length === 0) return
    this.emitterFor(projectId).emit('metrics', batch)
  }

  close(): void {
    for (const e of this.emitters.values()) e.removeAllListeners()
    this.emitters.clear()
  }
}
