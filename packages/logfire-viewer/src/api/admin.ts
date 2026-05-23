import type Database from 'better-sqlite3'
import { existsSync, unlinkSync } from 'node:fs'
import { Hono } from 'hono'

import { generateToken } from '../auth/tokens.js'
import type { AuthVariables } from '../auth/middleware.js'
import { requireAdmin } from '../auth/middleware.js'
import type { ProjectRegistry } from '../tenancy/registry.js'
import {
  createProject,
  deleteProject,
  getProject,
  getProjectBySlug,
  insertToken,
  listActiveTokens,
  listAllSettings,
  listProjects,
  revokeToken,
  setSetting,
  updateProject,
} from '../tenancy/projects.js'

function nsValueToMs(ns: bigint | number | null | undefined): number {
  if (ns == null) return 0
  if (typeof ns === 'number') return Math.trunc(ns / 1_000_000)
  return Number(ns / 1_000_000n)
}

function serializeBigints(obj: object): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'bigint') {
      out[k] = Number(v / 1_000_000n)
    } else if (k.endsWith('_ns') && typeof v === 'number') {
      out[k] = Math.trunc(v / 1_000_000)
    } else {
      out[k] = v
    }
  }
  return out
}

export function adminApi(
  adminDb: Database.Database,
  registry: ProjectRegistry,
  dataDir: string,
): Hono<{ Variables: AuthVariables }> {
  const app = new Hono<{ Variables: AuthVariables }>()
  app.use('*', requireAdmin(registry))

  app.get('/projects', (c) => {
    const projects = listProjects(adminDb).map(serializeBigints)
    return c.json({ projects })
  })

  app.post('/projects', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      slug?: string
      name?: string
      retention_days?: number
      retention_max_rows?: number
      sampling_rate?: number
      rate_limit_rps?: number | null
      rate_limit_burst?: number | null
    }
    if (!body.slug) return c.json({ error: 'slug is required' }, 400)
    if (getProjectBySlug(adminDb, body.slug)) {
      return c.json({ error: 'project slug already exists' }, 409)
    }
    const project = createProject(adminDb, dataDir, {
      slug: body.slug,
      name: body.name,
      retentionDays: body.retention_days,
      retentionMaxRows: body.retention_max_rows,
      samplingRate: body.sampling_rate,
      rateLimitRps: body.rate_limit_rps,
      rateLimitBurst: body.rate_limit_burst,
    })
    // Open the data DB now so the file is created with schema applied.
    registry.getDb(project)
    return c.json({ project: serializeBigints(project) }, 201)
  })

  app.patch('/projects/:id', async (c) => {
    const id = c.req.param('id')
    if (!getProject(adminDb, id)) return c.json({ error: 'not found' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
    const project = updateProject(adminDb, id, {
      name: body.name as string | undefined,
      retentionDays: body.retention_days as number | undefined,
      retentionMaxRows: body.retention_max_rows as number | undefined,
      samplingRate: body.sampling_rate as number | undefined,
      rateLimitRps: body.rate_limit_rps as number | null | undefined,
      rateLimitBurst: body.rate_limit_burst as number | null | undefined,
    })
    registry.invalidateAll()
    return c.json({ project: project ? serializeBigints(project) : null })
  })

  app.delete('/projects/:id', (c) => {
    const id = c.req.param('id')
    const project = getProject(adminDb, id)
    if (!project) return c.json({ error: 'not found' }, 404)
    const purge = new URL(c.req.url).searchParams.get('purge') === '1'
    deleteProject(adminDb, id)
    registry.invalidateAll()
    if (purge && existsSync(project.db_path)) {
      try {
        unlinkSync(project.db_path)
      } catch {
        // best-effort
      }
    }
    return c.json({ ok: true })
  })

  app.get('/projects/:id/tokens', (c) => {
    const id = c.req.param('id')
    const tokens = listActiveTokens(adminDb, id).map((t) => ({
      id: t.id,
      project_id: t.project_id,
      name: t.name,
      token_prefix: t.token_prefix,
      scopes: t.scopes,
      created_at_ms: nsValueToMs(t.created_at_ns),
      last_used_at_ms: t.last_used_at_ns != null ? nsValueToMs(t.last_used_at_ns) : null,
    }))
    return c.json({ tokens })
  })

  app.post('/projects/:id/tokens', async (c) => {
    const id = c.req.param('id')
    if (!getProject(adminDb, id)) return c.json({ error: 'not found' }, 404)
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: string
      scopes?: string
    }
    const { plaintext, prefix, storedHash } = generateToken()
    const token = insertToken(adminDb, {
      projectId: id,
      name: body.name ?? 'unnamed',
      scopes: body.scopes ?? 'write,read',
      tokenHash: storedHash,
      tokenPrefix: prefix,
    })
    registry.invalidateAll()
    return c.json(
      {
        token: {
          id: token.id,
          name: token.name,
          scopes: token.scopes,
          token_prefix: token.token_prefix,
          plaintext,
        },
      },
      201,
    )
  })

  app.delete('/tokens/:tokenId', (c) => {
    const tokenId = c.req.param('tokenId')
    revokeToken(adminDb, tokenId)
    registry.invalidateAll()
    return c.json({ ok: true })
  })

  app.get('/settings', (c) => {
    const settings = listAllSettings(adminDb)
    // Don't leak the admin token hash.
    delete settings.admin_token_hash
    return c.json({ settings })
  })

  app.patch('/settings', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, string | number>
    for (const [k, v] of Object.entries(body)) {
      if (k === 'admin_token_hash') continue
      setSetting(adminDb, k, String(v))
    }
    const settings = listAllSettings(adminDb)
    delete settings.admin_token_hash
    return c.json({ settings })
  })

  app.post('/admin-token/reset', (c) => {
    const { plaintext, storedHash } = generateToken()
    setSetting(adminDb, 'admin_token_hash', storedHash)
    registry.invalidateAll()
    return c.json({ plaintext })
  })

  return app
}
