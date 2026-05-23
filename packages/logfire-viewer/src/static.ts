import { readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { Hono } from 'hono'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
}

function safeJoin(base: string, request: string): string | null {
  const decoded = decodeURIComponent(request.replace(/^\/+/, ''))
  const resolved = resolve(base, decoded)
  if (!resolved.startsWith(resolve(base))) return null
  return resolved
}

export function staticApp(webRoot: string): Hono {
  const root = resolve(webRoot)
  const app = new Hono()

  app.get('*', (c) => {
    const path = new URL(c.req.url).pathname
    const target = safeJoin(root, path === '/' ? 'index.html' : path)
    if (target) {
      try {
        const stat = statSync(target)
        if (stat.isFile()) {
          const ext = extname(target).toLowerCase()
          const ct = MIME_TYPES[ext] ?? 'application/octet-stream'
          return new Response(readFileSync(target), {
            headers: { 'content-type': ct },
          })
        }
      } catch {
        // fall through to SPA fallback
      }
    }
    // SPA fallback to index.html
    try {
      const indexHtml = readFileSync(join(root, 'index.html'), 'utf8')
      return new Response(indexHtml, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    } catch {
      return c.text('Web UI not built. Run `npm run build:web`.', 503)
    }
  })

  return app
}
