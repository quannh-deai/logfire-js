import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { DATA_SCHEMA } from '../db/index.js'
import { insertSpans } from '../ingest/insert.js'
import { sweepProject } from '../retention/sweeper.js'
import type { Project, SpanRow } from '../types.js'

function makeRow(spanId: string, startNs: bigint): SpanRow {
  return {
    trace_id: 'a'.repeat(32),
    span_id: spanId,
    parent_span_id: null,
    name: 'x',
    start_time_ns: startNs,
    end_time_ns: startNs + 1_000_000n,
    duration_ns: 1_000_000n,
    status_code: 0,
    status_message: null,
    kind: 0,
    service_name: 'svc',
    service_version: null,
    deployment_environment: null,
    scope_name: 'scope',
    scope_version: null,
    logfire_msg: 'x',
    logfire_level_num: 9,
    logfire_span_type: null,
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
    received_at_ns: startNs,
  }
}

describe('retention sweeper', () => {
  let dir: string
  let db: Database.Database

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lfv-retention-'))
    db = new Database(join(dir, 'data.db'))
    db.exec(DATA_SCHEMA)
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  test('deletes spans older than retention_days', () => {
    const now = BigInt(Date.now()) * 1_000_000n
    const oldRow = makeRow('1'.repeat(16), now - 10n * 86_400_000_000_000n) // 10 days
    const newRow = makeRow('2'.repeat(16), now)
    insertSpans(db, [oldRow, newRow])
    const project: Project = {
      id: 'p',
      slug: 'p',
      name: 'p',
      db_path: '',
      retention_days: 7,
      retention_max_rows: 0,
      sampling_rate: 1,
      rate_limit_rps: null,
      rate_limit_burst: null,
      created_at_ns: 0n,
    }
    const stats = sweepProject(db, project)
    expect(stats.spansDeleted).toBe(1)
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM spans').get() as { n: number }
    expect(remaining.n).toBe(1)
  })

  test('enforces retention_max_rows', () => {
    const now = BigInt(Date.now()) * 1_000_000n
    const rows: SpanRow[] = []
    for (let i = 0; i < 10; i++) {
      rows.push(makeRow(String(i).padStart(16, '0'), now + BigInt(i)))
    }
    insertSpans(db, rows)
    const project: Project = {
      id: 'p',
      slug: 'p',
      name: 'p',
      db_path: '',
      retention_days: 0,
      retention_max_rows: 3,
      sampling_rate: 1,
      rate_limit_rps: null,
      rate_limit_burst: null,
      created_at_ns: 0n,
    }
    sweepProject(db, project)
    const remaining = db.prepare('SELECT COUNT(*) AS n FROM spans').get() as { n: number }
    expect(remaining.n).toBe(3)
  })
})
