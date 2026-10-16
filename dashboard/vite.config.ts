import os from 'node:os'
import path from 'node:path'
import { readdirSync, readFileSync, realpathSync } from 'node:fs'
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

/**
 * Our own accounts: one Studio snapshot per file, `<db dir>/own/<platform@handle>/<YYYY-MM-DD>.json`.
 * Returns the latest snapshot of each account plus the dates on disk.
 */
function readOwn(): { account: string; dates: string[]; data: unknown }[] {
  const root = path.join(path.dirname(dbPath()), 'own')
  let accounts: string[]
  try {
    accounts = readdirSync(root).filter((a) => ACCOUNT_RE.test(a))
  } catch {
    return [] // no snapshot yet
  }
  return accounts.flatMap((account) => {
    const dates = readdirSync(path.join(root, account))
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse()
    if (!dates.length) return []
    const data = JSON.parse(readFileSync(path.join(root, account, `${dates[0]}.json`), 'utf8'))
    return [{ account, dates, data }]
  })
}

/**
 * TikTok Shop watch, from the `shop_*` tables: products with a per-day views series (sum over their
 * videos), every video with its latest snapshot, query yield and creators. `day` is the latest
 * `~/.jev-social/shop/<date>.json` for collection health (errors, deferred cards). null = no collect yet.
 */
function readShop(): unknown {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath(), { readOnly: true })
  } catch {
    return null
  }
  try {
    if (!hasTable(db, 'shop_snapshots')) return null
    const dates = (db.prepare("SELECT DISTINCT date FROM shop_snapshots WHERE kind = 'video' ORDER BY date").all() as Row[]).map((r) => String(r.date))
    if (!dates.length) return null
    const videos = db
      .prepare(
        `SELECT v.url, v.handle, v.product_id AS productId, v.is_ec AS isEc, v.caption, v.created_at AS createdAt, v.mode, v.query, v.first_seen AS firstSeen,
                s.date, s.views, s.likes, s.comments, s.shares, s.saves
         FROM shop_videos v JOIN shop_snapshots s ON s.kind = 'video' AND s.id = v.url
           AND s.date = (SELECT MAX(date) FROM shop_snapshots WHERE kind = 'video' AND id = v.url)`,
      )
      .all() as Row[]
    const series = db
      .prepare(
        `SELECT v.product_id AS productId, s.date, SUM(COALESCE(s.views, 0)) AS views, COUNT(*) AS videos
         FROM shop_videos v JOIN shop_snapshots s ON s.kind = 'video' AND s.id = v.url
         WHERE v.product_id IS NOT NULL GROUP BY v.product_id, s.date ORDER BY s.date`,
      )
      .all() as Row[]
    const byProduct = new Map<string, { date: string; views: number; videos: number }[]>()
    for (const r of series) {
      const id = String(r.productId)
      byProduct.set(id, [...(byProduct.get(id) ?? []), { date: String(r.date), views: Number(r.views), videos: Number(r.videos) }])
    }
    const products = (db.prepare('SELECT * FROM shop_products').all() as Row[]).map((p) => {
      const id = String(p.product_id)
      const vids = videos.filter((v) => v.productId === id)
      return {
        productId: id,
        title: p.title,
        shortTitle: p.short_title,
        url: p.url,
        coverUrl: p.cover_url,
        sellerId: p.seller_id,
        categories: JSON.parse(String(p.categories || '[]')) as string[],
        skuCount: p.sku_count,
        firstSeen: p.first_seen,
        videos: vids.length,
        creators: new Set(vids.map((v) => v.handle)).size,
        series: byProduct.get(id) ?? [],
      }
    })
    const creators = (db.prepare('SELECT handle, display_name AS displayName, followers FROM shop_creators').all() as Row[]).map((c) => {
      const vids = videos.filter((v) => v.handle === c.handle)
      const views = vids.map((v) => Number(v.views ?? 0)).sort((a, b) => a - b)
      return {
        handle: c.handle,
        displayName: c.displayName,
        followers: c.followers,
        videos: vids.length,
        shopVideos: vids.filter((v) => Number(v.isEc) === 1 || v.productId).length,
        products: new Set(vids.map((v) => v.productId).filter(Boolean)).size,
        medianViews: views.length ? views[Math.floor(views.length / 2)] : null,
      }
    })
    const queries = new Map<string, { mode: string; query: string; videos: number; withProduct: number; shop: number }>()
    for (const v of videos) {
      const key = `${v.mode} ${v.query}`
      const q = queries.get(key) ?? { mode: String(v.mode), query: String(v.query), videos: 0, withProduct: 0, shop: 0 }
      q.videos += 1
      if (v.productId) q.withProduct += 1
      if (Number(v.isEc) === 1) q.shop += 1
      queries.set(key, q)
    }
    let day: unknown = null
    try {
      const root = path.join(path.dirname(dbPath()), 'shop')
      const latest = readdirSync(root).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1)
      if (latest) day = JSON.parse(readFileSync(path.join(root, latest), 'utf8'))
    } catch {
      // day file is optional
    }
    return { dates, videos, products, creators, queries: [...queries.values()], day }
  } finally {
    db.close()
  }
}

/**
 * The production calendar (markdown), read-only: every table as { section, rows: [{ header: cell }] }.
 * Path: JEV_CALENDAR, default the Foot Manga Drama calendar.
 */
const SERIES_DIR = process.env.JEV_SERIES_DIR || path.join(os.homedir(), 'cinema', 'drama', 'foot-manga-drama')

function readCalendar() {
  return readTables(process.env.JEV_CALENDAR || path.join(SERIES_DIR, 'Calendar.md'))
}

/** Backlog.md cards plus the story folders (`0X - …`) of the series, so unsorted ones show up. */
function readBacklog() {
  let folders: string[] = []
  try {
    folders = readdirSync(SERIES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^\d{2} - /.test(d.name))
      .map((d) => d.name)
  } catch {
    // no series folder: cards only
  }
  return { cards: readTables(path.join(SERIES_DIR, 'Backlog.md')).flatMap((t) => t.rows), folders }
}

function readTables(file: string): { section: string; rows: Record<string, string>[] }[] {
  let lines: string[]
  try {
    lines = readFileSync(file, 'utf8').split('\n')
  } catch {
    return []
  }
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
  const tables: { section: string; rows: Record<string, string>[] }[] = []
  let section = ''
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('#')) section = lines[i].replace(/^#+\s*/, '')
    if (!lines[i].startsWith('|') || !/^\|[\s:|-]+\|$/.test(lines[i + 1]?.trim() ?? '')) continue
    const header = cells(lines[i])
    const rows: Record<string, string>[] = []
    for (i += 2; lines[i]?.startsWith('|'); i++) {
      const c = cells(lines[i])
      rows.push(Object.fromEntries(header.map((h, k) => [h, c[k] ?? ''])))
    }
    tables.push({ section, rows })
  }
  return tables
}

/**
 * Story radar, written by `jev-social radar`: one row per story (its Jev-scored item),
 * with how many items and distinct sources carried it in the last 72 h. [] until the first run.
 */
function readRadar(): unknown[] {
  let db: DatabaseSync
  try {
    db = new DatabaseSync(dbPath(), { readOnly: true })
  } catch {
    return []
  }
  try {
    if (!hasTable(db, 'radar_items')) return []
    const since = new Date(Date.now() - 72 * 36e5).toISOString()
    const rows = db.prepare('SELECT * FROM radar_items WHERE published_at >= ? OR published_at IS NULL').all(since) as Row[]
    const byStory = new Map<string, Row[]>()
    for (const r of rows) byStory.set(String(r.story), [...(byStory.get(String(r.story)) ?? []), r])
    return [...byStory.values()].flatMap((group) => {
      const head = group.find((r) => r.jev)
      if (!head) return []
      const dates = group.map((r) => String(r.published_at ?? '')).filter(Boolean).sort()
      return [{
        id: head.id,
        title: head.title,
        link: head.link,
        summary: head.summary,
        cast: JSON.parse(String(head.cast_names)),
        jev: JSON.parse(String(head.jev)),
        score: head.score,
        items: group.length,
        sources: [...new Set(group.map((r) => String(r.source)))].slice(0, 8),
        sourceCount: new Set(group.map((r) => r.source)).size,
        firstSeen: dates[0] ?? null,
        lastSeen: dates.at(-1) ?? null,
      }]
    }).sort((a, b) => Number(b.score) - Number(a.score))
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
          if (pathname === '/backlog' || pathname === '/backlog/') {
            return send(res, 200, readBacklog())
          }
          if (pathname === '/radar' || pathname === '/radar/') {
            return send(res, 200, readRadar())
          }
          if (pathname === '/calendar' || pathname === '/calendar/') {
            return send(res, 200, readCalendar())
          }
          if (pathname === '/own' || pathname === '/own/') {
            return send(res, 200, readOwn())
          }
          if (pathname === '/shop' || pathname === '/shop/') {
            return send(res, 200, readShop())
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
