import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { fmtCompact, fmtPct } from '@/lib/format'
import { MONO, T } from '@/lib/tokens'

/** TikTok Shop charts. One hue (violet) + de-emphasis gray; grid light and solid; direct labels at the tip only. */

const axisTick = { fill: T.muted, fontSize: 11, fontFamily: MONO }
const tooltipBox = 'max-w-[280px] rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs text-fg'
const short = (s: string, n = 22) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export interface RisingRow {
  productId: string
  label: string
  value: number
  creators: number
  videos: number
}

/** Products by views delta (or views on the first day): horizontal bars, value at the tip. */
export function RisingBars({ rows, fmt = fmtCompact }: { rows: RisingRow[]; fmt?: (v: number | null) => string }) {
  const data = rows.map((r) => ({ ...r, v: Math.max(r.value, 0) }))
  return (
    <div style={{ height: Math.max(120, data.length * 36 + 12) }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, bottom: 0, left: 0 }} barCategoryGap={8}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis
            type="category"
            dataKey="label"
            width={178}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={(props: { x: number | string; y: number | string; payload: { value: string; index: number } }) => {
              const r = data[props.payload.index]
              return (
                <g transform={`translate(${Number(props.x)},${Number(props.y)})`}>
                  <text x={-8} y={-2} textAnchor="end" fill={T.text} fontSize={12}>
                    {short(props.payload.value)}
                  </text>
                  <text x={-8} y={11} textAnchor="end" fill={T.muted} fontSize={10} fontFamily={MONO}>
                    {r?.creators ?? 0} creator{r?.creators === 1 ? '' : 's'} · {r?.videos ?? 0} video{r?.videos === 1 ? '' : 's'}
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
                    <span className="text-fg">{fmt(p.value)}</span> · {p.videos} video{p.videos === 1 ? '' : 's'} · {p.creators} creator{p.creators === 1 ? '' : 's'}
                  </p>
                </div>
              )
            }}
          />
          <Bar dataKey="v" radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={18}>
            {data.map((d) => (
              <Cell key={d.productId} fill={T.violet} fillOpacity={0.9} />
            ))}
            <LabelList dataKey="value" position="right" fill={T.text} fontSize={11} fontFamily={MONO} formatter={(v: unknown) => fmt(typeof v === 'number' ? v : null)} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface IntentPoint {
  url: string
  handle: string
  views: number
  saveRate: number
  isEc: boolean
  product: string | null
}

/** Views (log) × save rate per video; product videos in violet, the rest in gray. */
export function IntentScatter({ points }: { points: IntentPoint[] }) {
  const data = points.filter((p) => p.views > 0)
  const xs = data.map((d) => d.views)
  const xDomain: [number, number] = [Math.min(...xs) / 2, Math.max(...xs) * 2]
  return (
    <div className="h-[280px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={T.line} />
          <XAxis type="number" dataKey="views" name="Views" scale="log" domain={xDomain} allowDataOverflow tick={axisTick} tickFormatter={(v: number) => fmtCompact(v)} axisLine={{ stroke: T.line }} tickLine={false} />
          <YAxis type="number" dataKey="saveRate" name="Save rate" tick={axisTick} tickFormatter={(v: number) => fmtPct(v, 1)} width={52} axisLine={false} tickLine={false} />
          <ZAxis type="number" range={[70, 70]} />
          <Tooltip
            cursor={{ stroke: T.line }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined
              if (!active || !p) return null
              return (
                <div className={tooltipBox}>
                  <p className="font-medium">@{p.handle}</p>
                  {p.product ? <p className="line-clamp-2 text-dim">{p.product}</p> : null}
                  <p className="num mt-1 text-dim">
                    views <span className="text-fg">{fmtCompact(p.views)}</span> · save rate <span className="text-fg">{fmtPct(p.saveRate, 2)}</span>
                  </p>
                </div>
              )
            }}
          />
          <Scatter data={data} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.url} fill={d.isEc ? T.violet : T.muted} fillOpacity={d.isEc ? 0.8 : 0.45} stroke={T.surface} strokeWidth={2} />
            ))}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface YieldRow {
  label: string
  videos: number
  withProduct: number
}

/** Share of videos with a product anchor per query: how much signal each hashtag gives. */
export function YieldBars({ rows }: { rows: YieldRow[] }) {
  const data = rows.map((r) => ({ ...r, rate: r.videos ? r.withProduct / r.videos : 0 }))
  return (
    <div style={{ height: Math.max(100, data.length * 36 + 12) }} className="w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, bottom: 0, left: 0 }} barCategoryGap={8}>
          <XAxis type="number" hide domain={[0, 1]} />
          <YAxis
            type="category"
            dataKey="label"
            width={150}
            tickLine={false}
            axisLine={false}
            interval={0}
            tick={(props: { x: number | string; y: number | string; payload: { value: string; index: number } }) => {
              const r = data[props.payload.index]
              return (
                <g transform={`translate(${Number(props.x)},${Number(props.y)})`}>
                  <text x={-8} y={-2} textAnchor="end" fill={T.text} fontSize={12}>
                    {short(props.payload.value, 20)}
                  </text>
                  <text x={-8} y={11} textAnchor="end" fill={T.muted} fontSize={10} fontFamily={MONO}>
                    {r?.withProduct ?? 0}/{r?.videos ?? 0} videos
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
                    <span className="text-fg">{p.withProduct}</span> of {p.videos} videos tag a product
                  </p>
                </div>
              )
            }}
          />
          <Bar dataKey="rate" fill={T.violet} fillOpacity={0.9} radius={[0, 4, 4, 0]} isAnimationActive={false} maxBarSize={16}>
            <LabelList dataKey="rate" position="right" fill={T.text} fontSize={11} fontFamily={MONO} formatter={(v: unknown) => (typeof v === 'number' ? fmtPct(v, 0) : '')} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface SeriesLine {
  productId: string
  label: string
  points: { date: string; views: number }[]
}

/** Cumulative views of the top products over the collection days; the leader in violet, the rest gray. */
export function ProductLines({ lines, dates }: { lines: SeriesLine[]; dates: string[] }) {
  const data = dates.map((date) => Object.fromEntries([['date', date], ...lines.map((l) => [l.productId, l.points.find((p) => p.date === date)?.views ?? null])]))
  return (
    <div className="h-[240px] w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={T.line} />
          <XAxis dataKey="date" tick={axisTick} tickLine={false} axisLine={{ stroke: T.line }} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmtCompact(v)} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              return (
                <div className={tooltipBox}>
                  <p className="font-medium">{label}</p>
                  {payload.map((p) => (
                    <p key={String(p.dataKey)} className="num text-dim">
                      {short(lines.find((l) => l.productId === p.dataKey)?.label ?? '', 32)} <span className="text-fg">{fmtCompact(p.value as number | null)}</span>
                    </p>
                  ))}
                </div>
              )
            }}
          />
          {lines.map((l, i) => (
            <Line key={l.productId} dataKey={l.productId} stroke={i === 0 ? T.violet : T.muted} strokeOpacity={i === 0 ? 1 : 0.5} strokeWidth={2} dot={{ r: 3, strokeWidth: 2, stroke: T.surface }} isAnimationActive={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
