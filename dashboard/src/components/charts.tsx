import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'
import { fmtCompact, fmtDate, fmtPct, fmtRatio, isNum } from '@/lib/format'
import { HIT_X, type ItemRow } from '@/lib/metrics'
import { MONO, T } from '@/lib/tokens'
import type { CategoryCrossing, Cohort, CohortMetric, NicheCohortComparison } from '@/types'

const axisTick = { fill: T.muted, fontSize: 11, fontFamily: MONO }
const tooltipBox = 'max-w-[260px] rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-fg'

export const METRIC_LABEL: Record<CohortMetric, string> = {
  medianViews: 'Median views',
  viewsPerFollower: 'Views / follower',
  shareRate: 'Share rate',
}

export function fmtMetric(metric: CohortMetric, v: number | null | undefined): string {
  if (metric === 'shareRate') return fmtPct(v)
  if (metric === 'viewsPerFollower') return fmtRatio(v)
  return fmtCompact(v)
}

/* ---------------- Cohort horizontal bars ---------------- */

export function CohortBars({ cohort, metric, colors }: { cohort: Cohort; metric: CohortMetric; colors: string[] }) {
  const data = cohort.buckets.map((b, i) => ({
    ...b,
    value: isNum(b[metric]) ? (b[metric] as number) : 0,
    missing: !isNum(b[metric]),
    fill: colors[i % colors.length],
  }))
  const height = Math.max(140, data.length * 44 + 16)
  return (
    <div style={{ height }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 0 }} barCategoryGap={10}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="label"
            width={146}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={(props: { x: number | string; y: number | string; payload: { value: string; index: number } }) => {
              const b = data[props.payload.index]
              return (
                <g transform={`translate(${Number(props.x)},${Number(props.y)})`}>
                  <text x={-8} y={-3} textAnchor="end" fill={T.text} fontSize={12}>
                    {props.payload.value.length > 20 ? `${props.payload.value.slice(0, 19)}…` : props.payload.value}
                  </text>
                  <text x={-8} y={11} textAnchor="end" fill={T.muted} fontSize={10} fontFamily={MONO}>
                    n={b?.count ?? 0} · {isNum(b?.jevConfidence) ? `conf ${b.jevConfidence.toFixed(2)}` : b?.confidence}
                  </text>
                </g>
              )
            }}
          />
          <Tooltip
            cursor={{ fill: T.surface2 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined
              if (!active || !p) return null
              return (
                <div className={tooltipBox}>
                  <p className="font-medium">{p.label}</p>
                  <p className="num mt-1 text-dim">
                    {METRIC_LABEL[metric]}: <span className="text-fg">{fmtMetric(metric, p[metric])}</span>
                  </p>
                  <p className="num text-dim">
                    videos: <span className="text-fg">{p.count}</span> · {p.confidence} sample
                  </p>
                  {isNum(p.jevConfidence) ? <p className="num text-dim">Jev confidence: <span className="text-fg">{p.jevConfidence.toFixed(2)}</span></p> : null}
                </div>
              )
            }}
          />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.fill} fillOpacity={d.missing ? 0 : 0.9} />
            ))}
            <LabelList
              dataKey={metric}
              position="right"
              fill={T.text}
              fontSize={11}
              fontFamily={MONO}
              formatter={(v: unknown) => fmtMetric(metric, typeof v === 'number' ? v : null)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ---------------- Views per item ---------------- */

export function ViewsChart({ rows, median }: { rows: ItemRow[]; median: number | null }) {
  const data = rows
    .filter((r) => isNum(r.views))
    .map((r) => ({ ...r, label: `#${r.index + 1}`, v: r.views as number }))
  return (
    <div className="h-[260px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 64, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={T.line} strokeDasharray="2 4" />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: T.line }} interval="preserveStartEnd" />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmtCompact(v)} />
          {isNum(median) ? (
            <ReferenceLine y={median} stroke={T.muted} strokeDasharray="4 4" label={{ value: 'median', position: 'right', fill: T.muted, fontSize: 10 }} />
          ) : null}
          {isNum(median) ? (
            <ReferenceLine y={median * HIT_X} stroke={T.accent} strokeOpacity={0.5} strokeDasharray="4 4" label={{ value: `${HIT_X}× med.`, position: 'right', fill: T.accent, fontSize: 10 }} />
          ) : null}
          <Tooltip
            cursor={{ fill: T.surface2 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined
              if (!active || !p) return null
              return (
                <div className={tooltipBox}>
                  <p className="line-clamp-3 break-words">{p.caption ?? <span className="text-dim italic">Caption not read</span>}</p>
                  <p className="num mt-1.5 text-dim">
                    views <span className="text-fg">{fmtCompact(p.views)}</span> · <span className={p.tier === 'hit' ? 'text-brand' : 'text-fg'}>{fmtRatio(p.xMedian, 1)}</span> median
                  </p>
                  <p className="num text-dim">{fmtDate(p.createdAt)}</p>
                </div>
              )
            }}
          />
          <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={40}>
            {data.map((d) => (
              <Cell key={d.url} fill={d.tier === 'hit' ? T.accent : d.tier === 'flop' ? T.line : T.violet} fillOpacity={d.tier === 'hit' ? 1 : 0.75} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ---------------- Niche scatter ---------------- */

export interface ScatterPoint {
  account: string
  followers: number
  medianViews: number
  hitRate: number | null
  platform: string
}

export function NicheScatter({ points }: { points: ScatterPoint[] }) {
  const data = points.map((p) => ({ ...p, z: isNum(p.hitRate) ? Math.max(p.hitRate, 0.02) : 0.02 }))
  // Pad log domains by 2× each side so bubbles and labels never sit on the edge.
  const pad = (vals: number[]): [number, number] => [Math.min(...vals) / 2, Math.max(...vals) * 2]
  const xDomain = pad(data.map((d) => d.followers))
  const yDomain = pad(data.map((d) => d.medianViews))
  return (
    <div className="h-[300px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 16, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke={T.line} strokeDasharray="2 4" />
          <XAxis type="number" dataKey="followers" name="Followers" scale="log" domain={xDomain} allowDataOverflow tick={axisTick} tickFormatter={(v: number) => fmtCompact(v)} axisLine={{ stroke: T.line }} tickLine={false} />
          <YAxis type="number" dataKey="medianViews" name="Median views" scale="log" domain={yDomain} allowDataOverflow tick={axisTick} tickFormatter={(v: number) => fmtCompact(v)} width={48} axisLine={false} tickLine={false} />
          <ZAxis type="number" dataKey="z" range={[80, 900]} domain={[0, 1]} />
          <Tooltip
            cursor={{ stroke: T.line }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined
              if (!active || !p) return null
              return (
                <div className={tooltipBox}>
                  <p className="font-medium">{p.account}</p>
                  <p className="num mt-1 text-dim">
                    followers <span className="text-fg">{fmtCompact(p.followers)}</span>
                  </p>
                  <p className="num text-dim">
                    median views <span className="text-fg">{fmtCompact(p.medianViews)}</span>
                  </p>
                  <p className="num text-dim">
                    hit rate <span className="text-fg">{fmtPct(p.hitRate, 0)}</span>
                  </p>
                </div>
              )
            }}
          />
          <Scatter data={data} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.account} fill={d.platform === 'instagram' ? T.violet : T.cyan} fillOpacity={0.55} stroke={d.platform === 'instagram' ? T.violet : T.cyan} />
            ))}
            <LabelList dataKey="account" position="top" fill={T.muted} fontSize={10} formatter={(v: unknown) => String(v).split('@')[1] ?? String(v)} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ---------------- Niche cohort comparison (grouped bars) ---------------- */

const SERIES = [T.violet, T.cyan, T.amber, T.accent, T.good]

export function NicheCohortChart({ comparison, fmt = fmtCompact }: { comparison: NicheCohortComparison; fmt?: (v: number | null) => string }) {
  const data = comparison.buckets.map((b) => ({
    bucket: b,
    ...Object.fromEntries(comparison.rows.map((r) => [r.account, r.values[b] ?? null])),
  }))
  return (
    <div className="h-[280px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={T.line} strokeDasharray="2 4" />
          <XAxis dataKey="bucket" tick={{ ...axisTick, fontFamily: undefined }} tickLine={false} axisLine={{ stroke: T.line }} interval={0} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmt(v)} />
          <Tooltip
            cursor={{ fill: T.surface2 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className={tooltipBox}>
                  <p className="font-medium">{label}</p>
                  {payload.map((p) => (
                    <p key={String(p.dataKey)} className="num text-dim">
                      <span style={{ color: p.color }}>●</span> {String(p.dataKey).split('@')[1]}{' '}
                      <span className="text-fg">{fmt(p.value as number | null)}</span>
                    </p>
                  ))}
                </div>
              )
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: T.muted }} formatter={(v: string) => `@${v.split('@')[1] ?? v}`} />
          {comparison.rows.map((r, i) => (
            <Bar key={r.account} dataKey={r.account} fill={SERIES[i % SERIES.length]} fillOpacity={0.85} radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={28} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ---------------- Crossing the niches ---------------- */

export function CrossingChart({ data }: { data: CategoryCrossing[] }) {
  return (
    <div style={{ height: data.length * 46 + 40 }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }} barGap={2} barCategoryGap={12}>
          <XAxis type="number" hide domain={[0, 100]} />
          <YAxis type="category" dataKey="category" width={84} tick={{ fill: T.text, fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: T.surface2 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className={tooltipBox}>
                  <p className="font-medium">{label}</p>
                  {payload.map((p) => (
                    <p key={String(p.dataKey)} className="num text-dim">
                      <span style={{ color: p.color }}>●</span> {p.name} <span className="text-fg">{String(p.value)}</span>
                    </p>
                  ))}
                </div>
              )
            }}
          />
          <Legend wrapperStyle={{ fontSize: 11, color: T.muted }} />
          <Bar dataKey="dramaVolume" name="Drama volume" fill={T.accent} radius={[0, 4, 4, 0]} barSize={8} isAnimationActive={false} />
          <Bar dataKey="mangaCoverage" name="Manga coverage" fill={T.cyan} radius={[0, 4, 4, 0]} barSize={8} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
