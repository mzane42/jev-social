import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyState, ExtLink, Panel, PlatformPill, SectionTitle, Warning } from '@/components/kit'
import { Pilot } from '@/components/Pilot'
import type { Features } from '@/lib/pilot'
import { fmtCompact, fmtPct, splitAccount } from '@/lib/format'
import { median } from '@/lib/metrics'
import { MONO, T } from '@/lib/tokens'
import { cn } from '@/lib/utils'

/** One Studio snapshot of one of our accounts (`~/.jev-social/own/<account>/<date>.json`). */
interface OwnVideo {
  id: string
  title: string
  publishedAt: string
  duration: number
  views: number
  likes: number
  shares: number
  saves: number
  avgWatch: number
  finishRate: number
  newFollowers: number
  uniqueViewers: number | null
  traffic: { fyp: number; search: number; profile: number }
  retention: number[]
  countries: Record<string, number>
  searches: string[]
  opening: string
  features?: Features
}
interface OwnSnapshot {
  date: string
  source: string
  retentionSeconds: number[]
  videos: OwnVideo[]
}
interface OwnAccount {
  account: string
  dates: string[]
  data: OwnSnapshot
}

const LINE_COLORS = [T.accent, T.cyan, T.amber, T.violet, T.good, T.muted, '#FF8FB1', '#7FD6FF']
// ponytail: n < 8 per account means hypotheses only (GUIDE-LOCAL §7); shown as a banner, not enforced.
const MIN_N = 8

const fyp = (v: OwnVideo) => Math.round(v.views * v.traffic.fyp)

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Panel as="div" className="p-4">
      <p className="text-xs text-dim">{label}</p>
      <p className="num mt-1 text-2xl font-semibold text-fg">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-dim">{hint}</p> : null}
    </Panel>
  )
}

function RetentionChart({ snap }: { snap: OwnSnapshot }) {
  const data = [0, ...snap.retentionSeconds].map((s, i) => {
    const row: Record<string, number> = { s }
    for (const v of snap.videos) row[v.id] = i === 0 ? 100 : v.retention[i - 1]
    return row
  })
  return (
    <div className="h-[300px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={T.line} strokeDasharray="2 4" />
          <XAxis dataKey="s" type="number" domain={[0, 'dataMax']} ticks={[0, ...snap.retentionSeconds]} tickFormatter={(s: number) => `${s}s`} tick={{ fill: T.muted, fontSize: 11, fontFamily: MONO }} axisLine={{ stroke: T.line }} tickLine={false} />
          <YAxis domain={[0, 100]} width={36} tickFormatter={(v: number) => `${v}%`} tick={{ fill: T.muted, fontSize: 11, fontFamily: MONO }} axisLine={false} tickLine={false} />
          <Tooltip
            contentStyle={{ background: T.surface2, border: `1px solid ${T.line}`, borderRadius: 12, fontSize: 12 }}
            labelFormatter={(s) => `${s} s`}
            formatter={(v, id) => [`${v}%`, snap.videos.find((x) => x.id === id)?.title ?? id]}
          />
          <Legend formatter={(id) => <span className="text-xs text-dim">{snap.videos.find((x) => x.id === id)?.title ?? id}</span>} />
          {snap.videos.map((v, i) => (
            <Line key={v.id} dataKey={v.id} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={2} dot={false} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function VideoTable({ account, snap }: { account: string; snap: OwnSnapshot }) {
  const { handle } = splitAccount(account)
  const at2 = snap.retentionSeconds.indexOf(2)
  const rows = [...snap.videos].sort((a, b) => fyp(b) - fyp(a))
  const th = 'px-3 py-2 text-left text-xs font-medium text-dim whitespace-nowrap'
  const td = 'px-3 py-2 align-top whitespace-nowrap num'
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-line">
          <tr>
            <th className={th}>Video</th>
            <th className={th}>Views</th>
            <th className={th}>FYP views</th>
            <th className={th}>Search</th>
            <th className={th}>Avg watch</th>
            <th className={th}>Finish</th>
            {at2 >= 0 ? <th className={th}>Still at 2 s</th> : null}
            <th className={th}>Top countries</th>
            <th className={th}>Opening (0–2 s)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-b border-line/60 last:border-0">
              <td className="px-3 py-2 align-top">
                <ExtLink href={`https://www.tiktok.com/@${handle}/video/${v.id}`}>{v.title}</ExtLink>
                <p className="num text-xs text-dim">{v.publishedAt} · {v.duration} s</p>
              </td>
              <td className={td}>{fmtCompact(v.views)}</td>
              <td className={cn(td, 'text-fg')}>{fmtCompact(fyp(v))}</td>
              <td className={td}>{fmtPct(v.traffic.search, 0)}</td>
              <td className={td}>{v.avgWatch.toFixed(1)} s <span className="text-dim">({fmtPct(v.avgWatch / v.duration, 0)})</span></td>
              <td className={td}>{fmtPct(v.finishRate)}</td>
              {at2 >= 0 ? <td className={td}>{v.retention[at2]}%</td> : null}
              <td className={td}>{Object.entries(v.countries).map(([c, p]) => `${c} ${p}`).join(' · ')}</td>
              <td className="min-w-[220px] px-3 py-2 align-top text-xs text-dim">{v.opening}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function OwnPage() {
  const params = useParams()
  const [accounts, setAccounts] = useState<OwnAccount[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/own')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setAccounts, () => setError(true))
  }, [])

  if (error) return <Warning>Could not read our account snapshots (/api/own).</Warning>
  if (!accounts) return <p className="text-sm text-dim">Loading…</p>
  if (!accounts.length) {
    return <EmptyState title="No account snapshot yet" body="Add ~/.jev-social/own/<platform@handle>/<YYYY-MM-DD>.json, then reload." />
  }

  const current = accounts.find((a) => a.account === params.account) ?? accounts[0]
  const snap = current.data
  const { platform, handle } = splitAccount(current.account)
  const vids = snap.videos
  const best = [...vids].sort((a, b) => fyp(b) - fyp(a))[0]

  return (
    <div className="space-y-6">
      <SectionTitle title="My accounts" hint="Our own accounts, from TikTok Studio snapshots. Compare videos on FYP views and watch time, never raw views." />

      <nav className="flex flex-wrap gap-2" aria-label="Accounts">
        {accounts.map((a) => (
          <Link
            key={a.account}
            to={`/me/${encodeURIComponent(a.account)}`}
            className={cn(
              'inline-flex h-8 items-center gap-2 rounded-full border px-3 text-sm',
              a.account === current.account ? 'border-violet bg-violet/10 text-fg' : 'border-line text-dim hover:text-fg',
            )}
          >
            <PlatformPill platform={splitAccount(a.account).platform} short />@{splitAccount(a.account).handle}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2 text-sm text-dim">
        <PlatformPill platform={platform} />
        <ExtLink href={`https://www.tiktok.com/@${handle}`}>@{handle}</ExtLink>
        <span>· snapshot {snap.date}</span>
        {current.dates.length > 1 ? <span>· {current.dates.length} snapshots on disk</span> : null}
      </div>

      {vids.length < MIN_N ? (
        <Warning>
          {vids.length} videos: below n = {MIN_N}, nothing here is a rule yet. Read it as hypotheses.
        </Warning>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Videos" value={String(vids.length)} />
        <Kpi label="Median views" value={fmtCompact(median(vids.map((v) => v.views)))} />
        <Kpi label="Median FYP views" value={fmtCompact(median(vids.map(fyp)))} hint="views × For You share" />
        <Kpi label="Best on FYP" value={fmtCompact(fyp(best))} hint={best.title} />
      </div>

      <Panel className="space-y-3 p-4">
        <SectionTitle title="Retention" hint="Share of viewers still watching at each second (Studio)." />
        <RetentionChart snap={snap} />
      </Panel>

      <Panel className="p-1">
        <VideoTable account={current.account} snap={snap} />
      </Panel>

      <Pilot
        past={vids.map((v) => ({ id: v.id, title: v.title, views: v.views, fyp: fyp(v), still2s: v.retention[snap.retentionSeconds.indexOf(2)] ?? null, features: v.features }))}
      />

      <p className="text-xs text-dim">Source: {snap.source}</p>
    </div>
  )
}
