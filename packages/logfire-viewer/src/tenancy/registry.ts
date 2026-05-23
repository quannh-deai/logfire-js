import type Database from 'better-sqlite3'

import { fingerprint, verifyToken } from '../auth/tokens.js'
import { closeHandles, openDataDb, type DbHandles } from '../db/index.js'
import type { Project, Token } from '../types.js'
import {
  getProject,
  listAllActiveTokens,
  touchTokenLastUsed,
} from './projects.js'

interface CacheEntry {
  expiresAtMs: number
  project: Project
  scopes: Set<string>
  tokenId: string
}

const TTL_MS = 60_000
const MAX_ENTRIES = 1024

export class ProjectRegistry {
  private adminDb: Database.Database
  private dbHandles = new Map<string, DbHandles>() // keyed by project id
  private tokenCache = new Map<string, CacheEntry>() // keyed by fingerprint(token)

  constructor(adminDb: Database.Database) {
    this.adminDb = adminDb
  }

  /** Resolve a project's data DB handles, opening (and caching) if needed. */
  getDb(project: Project): DbHandles {
    const existing = this.dbHandles.get(project.id)
    if (existing) return existing
    const handles = openDataDb(project.db_path)
    this.dbHandles.set(project.id, handles)
    return handles
  }

  /** Resolve a token to its project + scopes. Returns null on miss/invalid. */
  resolveToken(plain: string): {
    project: Project
    scopes: Set<string>
    tokenId: string
    db: DbHandles
  } | null {
    if (!plain) return null
    const fp = fingerprint(plain)
    const now = Date.now()
    const cached = this.tokenCache.get(fp)
    if (cached && cached.expiresAtMs > now) {
      return {
        project: cached.project,
        scopes: cached.scopes,
        tokenId: cached.tokenId,
        db: this.getDb(cached.project),
      }
    }
    // Miss — scan active tokens and verify.
    const tokens = listAllActiveTokens(this.adminDb)
    for (const t of tokens) {
      if (!verifyToken(plain, t.token_hash)) continue
      const project = getProject(this.adminDb, t.project_id)
      if (!project) return null
      const scopes = new Set(
        t.scopes
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
      this.putCacheEntry(fp, { project, scopes, tokenId: t.id })
      // Best-effort touch
      try {
        touchTokenLastUsed(this.adminDb, t.id)
      } catch {
        // ignore
      }
      return { project, scopes, tokenId: t.id, db: this.getDb(project) }
    }
    return null
  }

  /**
   * Resolve the admin token. The admin token is stored as a verifier in the
   * settings table under `admin_token_hash`. Tokens with the `admin` scope in
   * the tokens table also pass admin auth.
   */
  resolveAdmin(plain: string): { scopes: Set<string> } | null {
    const settingsHash = this.adminDb
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('admin_token_hash') as { value: string } | undefined
    if (settingsHash && verifyToken(plain, settingsHash.value)) {
      return { scopes: new Set(['admin', 'read', 'write']) }
    }
    const resolved = this.resolveToken(plain)
    if (resolved && resolved.scopes.has('admin')) {
      return { scopes: resolved.scopes }
    }
    return null
  }

  /** Drop a cached token (e.g. after revoke). */
  invalidateToken(plain: string): void {
    this.tokenCache.delete(fingerprint(plain))
  }

  invalidateAll(): void {
    this.tokenCache.clear()
  }

  /** Close all open data-DB handles. */
  close(): void {
    for (const h of this.dbHandles.values()) closeHandles(h)
    this.dbHandles.clear()
    this.tokenCache.clear()
  }

  /** Iterate over currently-open data DBs (for the retention sweeper). */
  *openDatabases(): IterableIterator<{ project: Project; db: DbHandles }> {
    for (const [id, db] of this.dbHandles) {
      const project = getProject(this.adminDb, id)
      if (project) yield { project, db }
    }
  }

  /** Force-open all known project DBs (used at startup). */
  warmAll(projects: Project[]): void {
    for (const p of projects) this.getDb(p)
  }

  private putCacheEntry(fp: string, entry: Omit<CacheEntry, 'expiresAtMs'>): void {
    // Simple LRU-ish eviction: drop oldest by insertion order.
    if (this.tokenCache.size >= MAX_ENTRIES) {
      const oldest = this.tokenCache.keys().next().value as string | undefined
      if (oldest) this.tokenCache.delete(oldest)
    }
    this.tokenCache.set(fp, { ...entry, expiresAtMs: Date.now() + TTL_MS })
  }

  /** Expose token lookup by id for admin operations. */
  getTokenRowById(id: string): Token | null {
    const row = this.adminDb
      .prepare('SELECT * FROM tokens WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined
    if (!row) return null
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
}
