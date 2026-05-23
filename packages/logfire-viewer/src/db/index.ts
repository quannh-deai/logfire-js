import Database from 'better-sqlite3'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import adminSchema from './admin.sql?raw'
import dataSchema from './data.sql?raw'

export const ADMIN_SCHEMA: string = adminSchema
export const DATA_SCHEMA: string = dataSchema

export interface DbHandles {
  rw: Database.Database
  ro: Database.Database
  path: string
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function openAdminDb(dataDir: string): Database.Database {
  ensureDir(dataDir)
  const path = resolve(dataDir, 'logfire-viewer.admin.db')
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.exec(ADMIN_SCHEMA)
  return db
}

export function openDataDb(path: string): DbHandles {
  ensureDir(dirname(path))
  const rw = new Database(path)
  rw.pragma('journal_mode = WAL')
  rw.pragma('synchronous = NORMAL')
  rw.exec(DATA_SCHEMA)
  const ro = new Database(path, { readonly: true, fileMustExist: true })
  ro.pragma('query_only = ON')
  ro.pragma('busy_timeout = 5000')
  return { rw, ro, path }
}

export function closeHandles(h: DbHandles): void {
  try {
    h.ro.close()
  } catch {
    // best-effort
  }
  try {
    h.rw.close()
  } catch {
    // best-effort
  }
}
