import type Database from 'better-sqlite3'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'

import type { Project, Token } from '../types.js'

function ulid(): string {
  // Simple 26-char monotonic-ish ID using crypto.randomBytes. Not strictly ULID,
  // but ULID-shaped enough for our needs and avoids an extra dependency.
  const time = Date.now().toString(36).padStart(10, '0').slice(-10)
  const rand = randomBytes(8).toString('hex').slice(0, 16)
  return `${time}${rand}`.toUpperCase()
}

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    slug: row.slug as string,
    name: row.name as string,
    db_path: row.db_path as string,
    retention_days: row.retention_days as number,
    retention_max_rows: row.retention_max_rows as number,
    sampling_rate: row.sampling_rate as number,
    rate_limit_rps: (row.rate_limit_rps as number | null) ?? null,
    rate_limit_burst: (row.rate_limit_burst as number | null) ?? null,
    created_at_ns: row.created_at_ns as bigint,
  }
}

function rowToToken(row: Record<string, unknown>): Token {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    name: row.name as string,
    token_hash: row.token_hash as string,
    token_prefix: row.token_prefix as string,
    scopes: row.scopes as string,
    created_at_ns: row.created_at_ns as bigint,
    last_used_at_ns: (row.last_used_at_ns as bigint | null) ?? null,
    revoked_at_ns: (row.revoked_at_ns as bigint | null) ?? null,
  }
}

export interface CreateProjectInput {
  slug: string
  name?: string
  retentionDays?: number
  retentionMaxRows?: number
  samplingRate?: number
  rateLimitRps?: number | null
  rateLimitBurst?: number | null
}

export function createProject(
  adminDb: Database.Database,
  dataDir: string,
  input: CreateProjectInput,
): Project {
  const slug = input.slug.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(slug)) {
    throw new Error(`Invalid project slug: "${slug}" (use a-z, 0-9, -, _)`)
  }
  const id = ulid()
  const dbPath = resolve(dataDir, `logfire-${slug}.db`)
  const now = BigInt(Date.now()) * 1_000_000n
  const stmt = adminDb.prepare(`
    INSERT INTO projects
      (id, slug, name, db_path, retention_days, retention_max_rows,
       sampling_rate, rate_limit_rps, rate_limit_burst, created_at_ns)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  stmt.run(
    id,
    slug,
    input.name ?? slug,
    dbPath,
    input.retentionDays ?? 30,
    input.retentionMaxRows ?? 5_000_000,
    input.samplingRate ?? 1.0,
    input.rateLimitRps ?? null,
    input.rateLimitBurst ?? null,
    now,
  )
  return getProject(adminDb, id)!
}

export function getProject(adminDb: Database.Database, id: string): Project | null {
  const row = adminDb
    .prepare('SELECT * FROM projects WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToProject(row) : null
}

export function getProjectBySlug(adminDb: Database.Database, slug: string): Project | null {
  const row = adminDb
    .prepare('SELECT * FROM projects WHERE slug = ?')
    .get(slug) as Record<string, unknown> | undefined
  return row ? rowToProject(row) : null
}

export function listProjects(adminDb: Database.Database): Project[] {
  const rows = adminDb
    .prepare('SELECT * FROM projects ORDER BY created_at_ns ASC')
    .all() as Record<string, unknown>[]
  return rows.map(rowToProject)
}

export interface UpdateProjectInput {
  name?: string
  retentionDays?: number
  retentionMaxRows?: number
  samplingRate?: number
  rateLimitRps?: number | null
  rateLimitBurst?: number | null
}

export function updateProject(
  adminDb: Database.Database,
  id: string,
  patch: UpdateProjectInput,
): Project | null {
  const fields: string[] = []
  const values: unknown[] = []
  if (patch.name !== undefined) {
    fields.push('name = ?')
    values.push(patch.name)
  }
  if (patch.retentionDays !== undefined) {
    fields.push('retention_days = ?')
    values.push(patch.retentionDays)
  }
  if (patch.retentionMaxRows !== undefined) {
    fields.push('retention_max_rows = ?')
    values.push(patch.retentionMaxRows)
  }
  if (patch.samplingRate !== undefined) {
    fields.push('sampling_rate = ?')
    values.push(patch.samplingRate)
  }
  if (patch.rateLimitRps !== undefined) {
    fields.push('rate_limit_rps = ?')
    values.push(patch.rateLimitRps)
  }
  if (patch.rateLimitBurst !== undefined) {
    fields.push('rate_limit_burst = ?')
    values.push(patch.rateLimitBurst)
  }
  if (fields.length === 0) return getProject(adminDb, id)
  values.push(id)
  adminDb.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getProject(adminDb, id)
}

export function deleteProject(adminDb: Database.Database, id: string): void {
  adminDb.prepare('DELETE FROM projects WHERE id = ?').run(id)
}

export interface CreateTokenInput {
  projectId: string
  name: string
  scopes: string
  tokenHash: string
  tokenPrefix: string
}

export function insertToken(adminDb: Database.Database, input: CreateTokenInput): Token {
  const id = ulid()
  const now = BigInt(Date.now()) * 1_000_000n
  adminDb
    .prepare(
      `INSERT INTO tokens
         (id, project_id, name, token_hash, token_prefix, scopes, created_at_ns)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, input.projectId, input.name, input.tokenHash, input.tokenPrefix, input.scopes, now)
  return getTokenById(adminDb, id)!
}

export function getTokenById(adminDb: Database.Database, id: string): Token | null {
  const row = adminDb
    .prepare('SELECT * FROM tokens WHERE id = ?')
    .get(id) as Record<string, unknown> | undefined
  return row ? rowToToken(row) : null
}

export function listActiveTokens(adminDb: Database.Database, projectId: string): Token[] {
  const rows = adminDb
    .prepare(
      'SELECT * FROM tokens WHERE project_id = ? AND revoked_at_ns IS NULL ORDER BY created_at_ns ASC',
    )
    .all(projectId) as Record<string, unknown>[]
  return rows.map(rowToToken)
}

export function listAllActiveTokens(adminDb: Database.Database): Token[] {
  const rows = adminDb
    .prepare('SELECT * FROM tokens WHERE revoked_at_ns IS NULL')
    .all() as Record<string, unknown>[]
  return rows.map(rowToToken)
}

export function revokeToken(adminDb: Database.Database, id: string): void {
  const now = BigInt(Date.now()) * 1_000_000n
  adminDb.prepare('UPDATE tokens SET revoked_at_ns = ? WHERE id = ?').run(now, id)
}

export function touchTokenLastUsed(adminDb: Database.Database, id: string): void {
  const now = BigInt(Date.now()) * 1_000_000n
  adminDb.prepare('UPDATE tokens SET last_used_at_ns = ? WHERE id = ?').run(now, id)
}

export function getSetting(adminDb: Database.Database, key: string): string | null {
  const row = adminDb.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

export function setSetting(adminDb: Database.Database, key: string, value: string): void {
  adminDb
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

export function listAllSettings(adminDb: Database.Database): Record<string, string> {
  const rows = adminDb.prepare('SELECT key, value FROM settings').all() as {
    key: string
    value: string
  }[]
  return Object.fromEntries(rows.map((r) => [r.key, r.value]))
}
