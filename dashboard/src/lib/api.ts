import { useCallback, useEffect, useState } from 'react'
import type { ReportEntry } from '@/types'

export type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; reports: ReportEntry[] }

export function useReportsLoader(): LoadState & { reload: () => void } {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const ctrl = new AbortController()
    setState({ status: 'loading' })
    fetch('/api/reports', { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`GET /api/reports returned ${res.status}`)
        const body: unknown = await res.json()
        if (!Array.isArray(body)) throw new Error('Unexpected response from /api/reports')
        setState({ status: 'ready', reports: body as ReportEntry[] })
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      })
    return () => ctrl.abort()
  }, [tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}

export interface NicheInfo {
  niche: string
  /** Latest report per account, sorted by account. */
  accounts: ReportEntry[]
}

/** Groups entries by niche, keeping the latest date per account. */
export function groupNiches(reports: ReportEntry[]): NicheInfo[] {
  const map = new Map<string, Map<string, ReportEntry>>()
  for (const r of reports) {
    const accs = map.get(r.niche) ?? new Map<string, ReportEntry>()
    const prev = accs.get(r.account)
    if (!prev || r.date > prev.date) accs.set(r.account, r)
    map.set(r.niche, accs)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([niche, accs]) => ({ niche, accounts: [...accs.values()].sort((a, b) => a.account.localeCompare(b.account)) }))
}
