import type { MiddlewareHandler } from 'hono'

import type { DbHandles } from '../db/index.js'
import type { ProjectRegistry } from '../tenancy/registry.js'
import type { Project } from '../types.js'

export interface AuthContext {
  project: Project
  scopes: Set<string>
  tokenId: string
  db: DbHandles
}

export type AuthVariables = {
  auth: AuthContext
  admin?: { scopes: Set<string> }
}

export function extractToken(header: string | null | undefined): string {
  if (!header) return ''
  const trimmed = header.trim()
  if (/^bearer\s+/i.test(trimmed)) return trimmed.replace(/^bearer\s+/i, '').trim()
  return trimmed
}

function tokenFromContext(c: { req: { header: (k: string) => string | undefined; url: string } }): string {
  const fromHeader = extractToken(c.req.header('authorization'))
  if (fromHeader) return fromHeader
  try {
    const url = new URL(c.req.url)
    return url.searchParams.get('token')?.trim() ?? ''
  } catch {
    return ''
  }
}

export function requireProject(
  registry: ProjectRegistry,
  requiredScope: 'read' | 'write' = 'read',
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const token = tokenFromContext(c)
    if (!token) {
      return c.json({ error: 'Missing Authorization header' }, 401)
    }
    const resolved = registry.resolveToken(token)
    if (!resolved) {
      return c.json({ error: 'Invalid or revoked token' }, 401)
    }
    if (!resolved.scopes.has(requiredScope) && !resolved.scopes.has('admin')) {
      return c.json({ error: `Token lacks required scope: ${requiredScope}` }, 403)
    }
    c.set('auth', {
      project: resolved.project,
      scopes: resolved.scopes,
      tokenId: resolved.tokenId,
      db: resolved.db,
    })
    await next()
  }
}

export function requireAdmin(
  registry: ProjectRegistry,
): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const token = tokenFromContext(c)
    if (!token) {
      return c.json({ error: 'Missing Authorization header' }, 401)
    }
    const admin = registry.resolveAdmin(token)
    if (!admin) {
      return c.json({ error: 'Admin token required' }, 403)
    }
    c.set('admin', admin)
    await next()
  }
}
