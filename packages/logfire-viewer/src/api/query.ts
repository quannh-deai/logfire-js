import { Hono } from 'hono'

import type { AuthVariables } from '../auth/middleware.js'
import { requireProject } from '../auth/middleware.js'
import type { ProjectRegistry } from '../tenancy/registry.js'

const SAFE_PREFIX = /^\s*(SELECT|WITH|EXPLAIN|PRAGMA)\b/i
const MULTI_STATEMENT = /;\s*\S/

const MAX_ROWS = 10_000

function safeJsonValue(v: unknown): unknown {
  if (typeof v === 'bigint') {
    if (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)) {
      return Number(v)
    }
    return v.toString()
  }
  if (v instanceof Uint8Array) return Buffer.from(v).toString('base64')
  return v
}

export function queryApi(registry: ProjectRegistry): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireProject(registry, 'read'))

  app.post('/query', async (c) => {
    let body: { sql?: string; params?: unknown[] }
    try {
      body = (await c.req.json()) as typeof body
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }
    const sql = (body.sql ?? '').toString()
    const params = Array.isArray(body.params) ? body.params : []
    if (!sql.trim()) return c.json({ error: 'sql is required' }, 400)
    if (!SAFE_PREFIX.test(sql)) {
      return c.json(
        { error: 'Only SELECT/WITH/EXPLAIN/PRAGMA statements are allowed.' },
        400,
      )
    }
    const trimmed = sql.replace(/;\s*$/, '')
    if (MULTI_STATEMENT.test(trimmed)) {
      return c.json({ error: 'Multiple statements are not allowed.' }, 400)
    }
    const { db } = c.get('auth')
    let stmt
    try {
      stmt = db.ro.prepare(trimmed)
    } catch (err) {
      return c.json({ error: `Prepare failed: ${(err as Error).message}` }, 400)
    }
    let rows: unknown[]
    try {
      stmt.raw(true)
      stmt.safeIntegers(true)
      rows = stmt.all(...params) as unknown[]
    } catch (err) {
      return c.json({ error: `Query failed: ${(err as Error).message}` }, 400)
    }
    const columns = stmt.columns().map((col) => col.name)
    const truncated = rows.length > MAX_ROWS
    const limited = truncated ? rows.slice(0, MAX_ROWS) : rows
    const data = (limited as unknown[][]).map((row) => row.map(safeJsonValue))
    return c.json({ columns, rows: data, truncated })
  })

  return app
}
