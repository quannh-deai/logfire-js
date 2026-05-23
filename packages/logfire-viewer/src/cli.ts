#!/usr/bin/env node
import mri from 'mri'
import { resolve } from 'node:path'

import { generateToken } from './auth/tokens.js'
import { openAdminDb } from './db/index.js'
import { startViewer } from './server.js'
import {
  createProject,
  getProjectBySlug,
  insertToken,
  listProjects,
  setSetting,
} from './tenancy/projects.js'

declare const PACKAGE_VERSION: string

type ParsedArgs = ReturnType<typeof mri> & Record<string, unknown>

const HELP = `\
logfire-viewer [command] [options]

Commands:
  serve (default)                    Run the server
  admin init                         Initialize admin DB, print admin token
  admin reset-token                  Re-roll the admin token
  admin add-project <slug>           Create a project
  admin list-projects                List projects
  admin add-token --project <slug>   Create a project token

Server options:
  --port <n>            HTTP port (default 4318; env LOGFIRE_VIEWER_PORT)
  --grpc-port <n>       gRPC port (default 4317; env LOGFIRE_VIEWER_GRPC_PORT)
  --no-grpc             Disable gRPC receiver
  --host <h>            Bind host (default 127.0.0.1)
  --data-dir <path>     Directory for admin + per-project DBs (default ./logfire-data)
  --max-rps <n>         Global ingest rate ceiling (default unlimited)
  --no-retention        Disable the retention sweeper

Common options:
  --help, -h            Show this help
  --version             Print version
`

function getVersion(): string {
  try {
    return typeof PACKAGE_VERSION === 'string' ? PACKAGE_VERSION : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

async function cmdServe(args: ParsedArgs): Promise<void> {
  const handle = await startViewer({
    dataDir: args['data-dir'] as string | undefined,
    port: args.port ? Number(args.port) : undefined,
    grpcPort: args['grpc-port'] ? Number(args['grpc-port']) : undefined,
    host: args.host as string | undefined,
    enableGrpc: args.grpc === false ? false : undefined,
    enableRetention: args.retention === false ? false : undefined,
    maxRps: args['max-rps'] ? Number(args['max-rps']) : undefined,
  })
  console.log('Press Ctrl+C to stop.')
  const onSignal = async (signal: string): Promise<void> => {
    console.log(`Received ${signal}, shutting down...`)
    await handle.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void onSignal('SIGINT'))
  process.on('SIGTERM', () => void onSignal('SIGTERM'))
}

function cmdAdminInit(args: ParsedArgs): void {
  const dataDir = resolve((args['data-dir'] as string | undefined) ?? './logfire-data')
  const db = openAdminDb(dataDir)
  const existing = db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('admin_token_hash') as { value: string } | undefined
  if (existing && !args.force) {
    console.log('Admin DB already initialized.')
    console.log('Use `admin reset-token` to re-roll the admin token.')
    db.close()
    return
  }
  const { plaintext, storedHash } = generateToken()
  setSetting(db, 'admin_token_hash', storedHash)
  console.log('Admin token (save this — shown once):')
  console.log(plaintext)
  db.close()
}

function cmdAdminResetToken(args: ParsedArgs): void {
  const dataDir = resolve((args['data-dir'] as string | undefined) ?? './logfire-data')
  const db = openAdminDb(dataDir)
  const { plaintext, storedHash } = generateToken()
  setSetting(db, 'admin_token_hash', storedHash)
  console.log('New admin token (save this — shown once):')
  console.log(plaintext)
  db.close()
}

function cmdAddProject(args: ParsedArgs): void {
  const slug = args._[2]
  if (!slug) {
    console.error('Usage: logfire-viewer admin add-project <slug>')
    process.exit(2)
  }
  const dataDir = resolve((args['data-dir'] as string | undefined) ?? './logfire-data')
  const db = openAdminDb(dataDir)
  if (getProjectBySlug(db, slug)) {
    console.error(`Project with slug "${slug}" already exists.`)
    db.close()
    process.exit(2)
  }
  const project = createProject(db, dataDir, {
    slug,
    name: (args.name as string | undefined) ?? slug,
    retentionDays: args['retention-days'] ? Number(args['retention-days']) : undefined,
    retentionMaxRows: args['retention-max-rows'] ? Number(args['retention-max-rows']) : undefined,
    samplingRate: args['sampling-rate'] ? Number(args['sampling-rate']) : undefined,
  })
  console.log('Project created:')
  console.log(`  id:        ${project.id}`)
  console.log(`  slug:      ${project.slug}`)
  console.log(`  db_path:   ${project.db_path}`)
  db.close()
}

function cmdListProjects(args: ParsedArgs): void {
  const dataDir = resolve((args['data-dir'] as string | undefined) ?? './logfire-data')
  const db = openAdminDb(dataDir)
  const projects = listProjects(db)
  if (projects.length === 0) {
    console.log('No projects.')
  } else {
    for (const p of projects) {
      console.log(`${p.slug}\t${p.id}\t${p.db_path}`)
    }
  }
  db.close()
}

function cmdAddToken(args: ParsedArgs): void {
  const slug = args.project as string | undefined
  if (!slug) {
    console.error('Usage: logfire-viewer admin add-token --project <slug> [--name <name>] [--scopes write,read]')
    process.exit(2)
  }
  const dataDir = resolve((args['data-dir'] as string | undefined) ?? './logfire-data')
  const db = openAdminDb(dataDir)
  const project = getProjectBySlug(db, slug)
  if (!project) {
    console.error(`Project "${slug}" not found.`)
    db.close()
    process.exit(2)
  }
  const { plaintext, prefix, storedHash } = generateToken()
  insertToken(db, {
    projectId: project.id,
    name: (args.name as string | undefined) ?? 'cli-issued',
    scopes: (args.scopes as string | undefined) ?? 'write,read',
    tokenHash: storedHash,
    tokenPrefix: prefix,
  })
  console.log('Token (save this — shown once):')
  console.log(plaintext)
  db.close()
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const args = mri(argv, {
    boolean: ['help', 'version', 'grpc', 'retention', 'force'],
    alias: { h: 'help' },
    default: { grpc: true, retention: true },
  })
  if (args.help) {
    console.log(HELP)
    return
  }
  if (args.version) {
    console.log(getVersion())
    return
  }
  const cmd = args._[0] ?? 'serve'
  const sub = args._[1]
  if (cmd === 'serve') return cmdServe(args)
  if (cmd === 'admin') {
    if (sub === 'init') return cmdAdminInit(args)
    if (sub === 'reset-token') return cmdAdminResetToken(args)
    if (sub === 'add-project') return cmdAddProject(args)
    if (sub === 'list-projects') return cmdListProjects(args)
    if (sub === 'add-token') return cmdAddToken(args)
    console.error(`Unknown admin subcommand: ${sub ?? '(none)'}`)
    console.error(HELP)
    process.exit(2)
  }
  console.error(`Unknown command: ${cmd}`)
  console.error(HELP)
  process.exit(2)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
