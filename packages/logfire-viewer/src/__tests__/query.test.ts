import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { generateToken } from '../auth/tokens.js'
import { ADMIN_SCHEMA, DATA_SCHEMA } from '../db/index.js'
import { queryApi } from '../api/query.js'
import { createProject, insertToken, setSetting } from '../tenancy/projects.js'
import { ProjectRegistry } from '../tenancy/registry.js'

describe('query API', () => {
  let dataDir: string
  let adminDb: Database.Database
  let registry: ProjectRegistry
  let token: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'lfv-query-'))
    adminDb = new Database(':memory:')
    adminDb.exec(ADMIN_SCHEMA)
    setSetting(adminDb, 'admin_token_hash', generateToken().storedHash)
    const project = createProject(adminDb, dataDir, { slug: 'demo' })
    const { plaintext, prefix, storedHash } = generateToken()
    insertToken(adminDb, {
      projectId: project.id,
      name: 'q',
      scopes: 'read',
      tokenHash: storedHash,
      tokenPrefix: prefix,
    })
    token = plaintext
    registry = new ProjectRegistry(adminDb)
    const handles = registry.getDb(project)
    handles.rw.exec(DATA_SCHEMA)
  })

  afterEach(() => {
    registry.close()
    adminDb.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  async function post(sql: string): Promise<Response> {
    const app = queryApi(registry)
    return app.request('/query', {
      method: 'POST',
      headers: { authorization: token, 'content-type': 'application/json' },
      body: JSON.stringify({ sql }),
    })
  }

  test('accepts simple SELECT', async () => {
    const res = await post('SELECT 1 AS one')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { columns: string[]; rows: unknown[][] }
    expect(body.columns).toEqual(['one'])
    expect(body.rows).toEqual([[1]])
  })

  test('accepts WITH and EXPLAIN', async () => {
    const r1 = await post('WITH t AS (SELECT 1 AS x) SELECT * FROM t')
    expect(r1.status).toBe(200)
    const r2 = await post('EXPLAIN SELECT * FROM spans')
    expect(r2.status).toBe(200)
  })

  test('rejects INSERT', async () => {
    const res = await post("INSERT INTO spans (trace_id, span_id, name, start_time_ns, end_time_ns, duration_ns, received_at_ns) VALUES ('x', 'y', 'z', 0, 0, 0, 0)")
    expect(res.status).toBe(400)
  })

  test('rejects multi-statement', async () => {
    const res = await post('SELECT 1; SELECT 2')
    expect(res.status).toBe(400)
  })
})
