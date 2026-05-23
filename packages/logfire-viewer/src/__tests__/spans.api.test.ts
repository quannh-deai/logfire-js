import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { generateToken } from '../auth/tokens.js'
import { ADMIN_SCHEMA, DATA_SCHEMA } from '../db/index.js'
import { spansApi } from '../api/spans.js'
import { insertSpans } from '../ingest/insert.js'
import {
  createProject,
  insertToken,
  setSetting,
} from '../tenancy/projects.js'
import { ProjectRegistry } from '../tenancy/registry.js'
import type { SpanRow } from '../types.js'

function makeRow(overrides: Partial<SpanRow>): SpanRow {
  return {
    trace_id: 'a'.repeat(32),
    span_id: 'b'.repeat(16),
    parent_span_id: null,
    name: 'hello',
    start_time_ns: 1_000_000_000n,
    end_time_ns: 1_500_000_000n,
    duration_ns: 500_000_000n,
    status_code: 0,
    status_message: null,
    kind: 0,
    service_name: 'svc',
    service_version: null,
    deployment_environment: null,
    scope_name: 'scope',
    scope_version: null,
    logfire_msg: 'hello',
    logfire_level_num: 9,
    logfire_span_type: 'span',
    logfire_msg_template: null,
    logfire_tags: null,
    attributes_json: '{}',
    resource_attributes_json: '{}',
    scope_attributes_json: null,
    events_json: null,
    links_json: null,
    dropped_attributes_count: 0,
    dropped_events_count: 0,
    dropped_links_count: 0,
    received_at_ns: 1_000_000_000n,
    ...overrides,
  }
}

describe('spans API', () => {
  let dataDir: string
  let adminDb: Database.Database
  let registry: ProjectRegistry
  let token: string

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'lfv-test-'))
    adminDb = new Database(':memory:')
    adminDb.exec(ADMIN_SCHEMA)
    // Bootstrap admin token + a project + a write/read token.
    const adminToken = generateToken()
    setSetting(adminDb, 'admin_token_hash', adminToken.storedHash)
    const project = createProject(adminDb, dataDir, { slug: 'demo' })
    const { plaintext, prefix, storedHash } = generateToken()
    insertToken(adminDb, {
      projectId: project.id,
      name: 'test',
      scopes: 'write,read',
      tokenHash: storedHash,
      tokenPrefix: prefix,
    })
    token = plaintext
    registry = new ProjectRegistry(adminDb)
    const handles = registry.getDb(project)
    handles.rw.exec(DATA_SCHEMA)
    // Seed 5 spans across two services and two levels.
    const rows: SpanRow[] = [
      makeRow({ span_id: '1'.repeat(16), service_name: 'svc-a', logfire_level_num: 9 }),
      makeRow({ span_id: '2'.repeat(16), service_name: 'svc-a', logfire_level_num: 13, name: 'warn-span', logfire_msg: 'warn-span' }),
      makeRow({ span_id: '3'.repeat(16), service_name: 'svc-b', logfire_level_num: 17, name: 'boom', logfire_msg: 'boom' }),
      makeRow({ span_id: '4'.repeat(16), service_name: 'svc-b', logfire_level_num: 9 }),
      makeRow({
        span_id: '5'.repeat(16),
        trace_id: 'c'.repeat(32),
        service_name: 'svc-c',
        logfire_level_num: 9,
        name: 'searchable',
        logfire_msg: 'searchable',
      }),
    ]
    insertSpans(handles.rw, rows)
  })

  afterEach(() => {
    registry.close()
    adminDb.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  test('lists spans without filters', async () => {
    const app = spansApi(registry)
    const res = await app.request('/spans', { headers: { authorization: token } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { rows: unknown[]; total: number }
    expect(body.rows.length).toBe(5)
    expect(body.total).toBe(5)
  })

  test('filters by service', async () => {
    const app = spansApi(registry)
    const res = await app.request('/spans?service=svc-a', { headers: { authorization: token } })
    const body = (await res.json()) as { total: number }
    expect(body.total).toBe(2)
  })

  test('filters by min-level', async () => {
    const app = spansApi(registry)
    const res = await app.request('/spans?level=13', { headers: { authorization: token } })
    const body = (await res.json()) as { total: number }
    expect(body.total).toBe(2)
  })

  test('FTS search matches by name', async () => {
    const app = spansApi(registry)
    const res = await app.request('/spans?q=searchable', { headers: { authorization: token } })
    const body = (await res.json()) as { total: number; rows: { name: string }[] }
    expect(body.total).toBe(1)
    expect(body.rows[0]!.name).toBe('searchable')
  })

  test('returns trace tree', async () => {
    const app = spansApi(registry)
    const res = await app.request(`/traces/${'a'.repeat(32)}`, { headers: { authorization: token } })
    const body = (await res.json()) as { spans: unknown[] }
    expect(body.spans.length).toBe(4)
  })

  test('rejects missing token with 401', async () => {
    const app = spansApi(registry)
    const res = await app.request('/spans')
    expect(res.status).toBe(401)
  })
})
