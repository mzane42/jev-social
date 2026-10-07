import os from 'node:os'
import path from 'node:path'
import { readFileSync, realpathSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { IncomingMessage, ServerResponse } from 'node:http'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Serves the local jev-social database to the dashboard during `vite` dev.
 *
 * Source: JEV_SOCIAL_DB (default ~/.jev-social/jev-social.db), written by
 * `jev-social profile` and `jev-social reports import|classify`. Opened read-only,
 * re-read on every request so new reports and classifications appear on reload.
 * Each item carries `jev`: its latest Jev classification in that niche, or null.
 */

const NICHE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const ACCOUNT_RE = /^[a-z][a-z0-9]{0,19}@[A-Za-z0-9._-]{1,100}$/

function dbPath(): string {
  const p = process.env.JEV_SOCIAL_DB || path.join(os.homedir(), '.jev-social', 'jev-social.db')
  return path.resolve(p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p)
}

interface ReportEntry {
  niche: string
  account: string
  date: string
  data: { snapshot?: { items?: { url: string; jev?: unknown; media?: unknown }[] } }
}

type Row = Record<string, string | number | null>

function hasTable(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

function readReports(): ReportEntry[] {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath(), { readOnly: true })
  } catch {
    return [] // no database yet: nothing imported
  }
  try {
    const reports = db.prepare('SELECT niche, account, date, data FROM reports ORDER BY niche, account, date DESC').all() as Row[]
    const classes = db
      .prepare(
        `SELECT c.* FROM classifications c
         WHERE c.classified_at = (SELECT MAX(classified_at) FROM classifications WHERE url = c.url AND niche = c.niche)`,
      )
      .all() as Row[]
    const byKey = new Map(
      classes.map((c) => [
        `${c.niche}\n${c.url}`,
        {
          theme: { value: c.theme, confidence: c.theme_conf },
          format: { value: c.format, confidence: c.format_conf },
          news: { value: c.news, confidence: c.news_conf },
        },
      ]),
    )
    const media = new Map(
      // The media table appears on the first `jev-social media` run; older databases lack it.
      (hasTable(db, 'media') ? (db.prepare('SELECT * FROM media').all() as Row[]) : []).map((m) => [
        `${m.niche}\n${m.url}`,
        {
          hookType: m.hook_type,
          hookNote: m.hook_note,
          head: m.transcript_head,
          frames: (JSON.parse(String(m.frames || '[]')) as string[]).length,
          error: m.error,
        },
      ]),
    )
    return reports.map((r) => {
      const data = JSON.parse(String(r.data)) as ReportEntry['data']
      for (const item of data.snapshot?.items ?? []) {
        item.jev = byKey.get(`${r.niche}\n${item.url}`) ?? null
        item.media = media.get(`${r.niche}\n${item.url}`) ?? null
      }
      return { niche: String(r.niche), account: String(r.account), date: String(r.date), data }
    })
  } finally {
    db.close()
  }
}

/** Frame n of a video's media row, only if the stored path resolves under the media root. */
function readFrame(url: string, n: number): Buffer | null {
  const root = path.resolve(process.env.JEV_SOCIAL_MEDIA_DIR || path.join(os.homedir(), '.jev-social', 'media'))
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath(), { readOnly: true })
  } catch {
    return null
  }
  try {
    const row = hasTable(db, 'media') ? (db.prepare('SELECT frames FROM media WHERE url = ?').get(url) as Row | undefined) : undefined
    const file = row ? (JSON.parse(String(row.frames || '[]')) as string[])[n] : undefined
    if (!file) return null
    const real = realpathSync(file)
    if (!real.startsWith(realpathSync(root) + path.sep) || !real.endsWith('.jpg')) return null
    return readFileSync(real)
  } catch {
    return null
  } finally {
    db.close()
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function decode(seg: string): string | null {
  try {
    return decodeURIComponent(seg)
  } catch {
    return null
  }
}

function reportsPlugin(): Plugin {
  return {
    name: 'jev-social-reports',
    configureServer(server) {
      server.middlewares.use('/api', async (req: IncomingMessage, res: ServerResponse, next) => {
        if (req.method !== 'GET') return send(res, 405, { error: 'method not allowed' })
        const pathname = (req.url || '/').split('?')[0]
        try {
          if (pathname === '/reports' || pathname === '/reports/') {
            return send(res, 200, readReports())
          }
          if (pathname === '/media/frame') {
            const q = new URLSearchParams((req.url || '').split('?')[1] || '')
            const n = Number(q.get('n'))
            const img = Number.isInteger(n) && n >= 0 && n < 10 ? readFrame(q.get('url') || '', n) : null
            if (!img) return send(res, 404, { error: 'frame not found' })
            res.setHeader('Content-Type', 'image/jpeg')
            res.setHeader('Cache-Control', 'private, max-age=3600')
            return res.end(img)
          }
          const m = pathname.match(/^\/reports\/([^/]+)\/([^/]+)\/latest\/?$/)
          if (m) {
            const niche = decode(m[1])
            const account = decode(m[2])
            if (!niche || !account || !NICHE_RE.test(niche) || !ACCOUNT_RE.test(account)) {
              return send(res, 400, { error: 'invalid niche or account' })
            }
            // readReports sorts dates newest first.
            const hit = readReports().find((r) => r.niche === niche && r.account === account)
            if (hit) return send(res, 200, hit)
            return send(res, 404, { error: 'report not found' })
          }
          return next()
        } catch {
          return send(res, 500, { error: 'failed to read reports' })
        }
      })
    },
  }
}

function csv(value = ''): string[] {
  return value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean)
}

const REMOTE_HOSTS = csv(process.env.JEV_SOCIAL_REMOTE_HOSTS)
const REMOTE_USERS = csv(process.env.JEV_SOCIAL_REMOTE_USERS)

/**
 * Opt-in tailnet access through Tailscale Serve, mirroring src/server.js: a request on a
 * non-local host must use an exact JEV_SOCIAL_REMOTE_HOSTS host:port and carry Serve's
 * Tailscale-User-Login, optionally narrowed by JEV_SOCIAL_REMOTE_USERS. Registered before
 * Vite's own middlewares, so it also guards source and /@fs requests.
 */
function remoteAccessPlugin(): Plugin {
  return {
    name: 'jev-social-remote-access',
    configureServer(server) {
      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next) => {
        const host = String(req.headers.host || '').toLowerCase()
        const hostname = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return next()
        const login = String(req.headers['tailscale-user-login'] || '').trim().toLowerCase()
        const allowed = REMOTE_HOSTS.includes(host) && login && (!REMOTE_USERS.length || REMOTE_USERS.includes(login))
        return allowed ? next() : send(res, 403, { error: 'forbidden' })
      })
    },
  }
}

export default defineConfig({
  plugins: [remoteAccessPlugin(), react(), tailwindcss(), reportsPlugin()],
  server: { allowedHosts: REMOTE_HOSTS.map((host) => host.replace(/:\d+$/, '')) },
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
})
