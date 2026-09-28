import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Serves local jev-social report folders to the dashboard during `vite` dev.
 *
 * Layout on disk: <root>/<niche>/<platform@handle>/<YYYY-MM-DD>/data.json
 * Roots: JEV_SOCIAL_REPORTS_DIR (default ~/.jev-social/reports), then every
 * comma-separated entry in JEV_SOCIAL_EXTRA_REPORTS (read-only, lower priority).
 * Nothing is cached: new niches appear on the next request.
 */

const NICHE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const ACCOUNT_RE = /^[a-z][a-z0-9]{0,19}@[A-Za-z0-9._-]{1,100}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

function reportRoots(): string[] {
  const primary = process.env.JEV_SOCIAL_REPORTS_DIR || path.join(os.homedir(), '.jev-social', 'reports')
  const extra = (process.env.JEV_SOCIAL_EXTRA_REPORTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  return [primary, ...extra]
    .map((p) => path.resolve(expandHome(p)))
    .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
}

function safeSegment(seg: string): boolean {
  return seg !== '.' && seg !== '..' && !seg.includes('/') && !seg.includes('\\') && !seg.includes('\0')
}

/** Resolves root/...segments and proves (through symlinks too) that it stays under root. */
async function resolveInside(root: string, ...segments: string[]): Promise<string | null> {
  if (!segments.every(safeSegment)) return null
  try {
    const realRoot = await fs.realpath(root)
    const real = await fs.realpath(path.join(realRoot, ...segments))
    return real.startsWith(realRoot + path.sep) ? real : null
  } catch {
    return null
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

async function readJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

interface ReportEntry {
  niche: string
  account: string
  date: string
  data: unknown
}

async function scanReports(): Promise<ReportEntry[]> {
  const out = new Map<string, ReportEntry>()
  for (const root of reportRoots()) {
    for (const niche of await listDirs(root)) {
      if (!NICHE_RE.test(niche)) continue
      const nicheDir = await resolveInside(root, niche)
      if (!nicheDir) continue
      for (const account of await listDirs(nicheDir)) {
        if (!ACCOUNT_RE.test(account)) continue
        const accountDir = await resolveInside(root, niche, account)
        if (!accountDir) continue
        for (const date of await listDirs(accountDir)) {
          if (!DATE_RE.test(date)) continue
          const key = `${niche}/${account}/${date}`
          if (out.has(key)) continue // first root wins
          const file = await resolveInside(root, niche, account, date, 'data.json')
          if (!file) continue
          const data = await readJson(file)
          if (data && typeof data === 'object') out.set(key, { niche, account, date, data })
        }
      }
    }
  }
  return [...out.values()].sort((a, b) =>
    a.niche.localeCompare(b.niche) || a.account.localeCompare(b.account) || b.date.localeCompare(a.date),
  )
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
            return send(res, 200, await scanReports())
          }
          const m = pathname.match(/^\/reports\/([^/]+)\/([^/]+)\/latest\/?$/)
          if (m) {
            const niche = decode(m[1])
            const account = decode(m[2])
            if (!niche || !account || !NICHE_RE.test(niche) || !ACCOUNT_RE.test(account)) {
              return send(res, 400, { error: 'invalid niche or account' })
            }
            // scanReports sorts dates newest first and applies root priority.
            const hit = (await scanReports()).find((r) => r.niche === niche && r.account === account)
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

export default defineConfig({
  plugins: [react(), tailwindcss(), reportsPlugin()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
})
