import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowDown, ArrowUp, ArrowUpDown, ChartScatter, ChevronRight, Clapperboard, EyeOff, RefreshCw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { useShell } from '@/components/AppShell'
import { CohortBars, METRIC_LABEL, ViewsChart } from '@/components/charts'
import { Chip, EmptyState, ExtLink, MockBadge, Panel, PlatformPill, SectionTitle, Warning } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtCompact, fmtDate, fmtNum, fmtPct, fmtRatio, isNum, NA, splitAccount } from '@/lib/format'
import { copyAvoidFrom, itemRows, jevCohort, jevLabel, medianViewsOf, summarize, tierCohort, type AccountSummary, type ItemRow, type Tier } from '@/lib/metrics'
import { T } from '@/lib/tokens'
import { cn } from '@/lib/utils'
import { accountExtrasMock } from '@/mocks/account'
import type { Cohort, CohortMetric, ReportEntry } from '@/types'
import { NotFound } from './Home'

export function AccountPage() {
  const { niche = '', account = '' } = useParams()
  const { niches } = useShell()
  const entry = niches.find((n) => n.niche === niche)?.accounts.find((a) => a.account === account)
  if (!entry) return <NotFound what="Account" />
  return <AccountView key={`${niche}/${account}/${entry.date}`} entry={entry} />
}

function AccountView({ entry }: { entry: ReportEntry }) {
  const d = entry.data
  const rows = useMemo(() => itemRows(d), [d])
  const summary = useMemo(() => summarize(d, rows), [d, rows])
  const { platform, handle } = splitAccount(entry.account)
  const read = d.snapshot.items.filter((i) => i.detailCaptured).length
  const displayName = d.snapshot.profile.displayName || `@${handle}`

  return (
    <div className="space-y-8">
      {/* Header */}
      <header className="space-y-4">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-dim">
          <Link to={`/n/${encodeURIComponent(entry.niche)}`} className="truncate hover:text-fg">
            {entry.niche}
          </Link>
          <ChevronRight className="size-3 shrink-0" aria-hidden />
          <span className="truncate text-fg">@{handle}</span>
        </nav>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="min-w-0 break-words text-2xl font-semibold sm:text-3xl">{displayName}</h1>
              <PlatformPill platform={platform} />
            </div>
            <p className="mt-1.5 text-sm text-dim">
              <ExtLink href={d.snapshot.url} className="text-dim">
                @{handle}
              </ExtLink>
              <span aria-hidden> · </span>captured <span className="num text-fg/80">{fmtDate(d.snapshot.capturedAt ?? entry.date)}</span>
              <span aria-hidden> · </span>
              <span className="num text-fg/80">
                {read}/{d.snapshot.items.length}
              </span>{' '}
              items read
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="lg" asChild>
              <Link to={`/n/${encodeURIComponent(entry.niche)}`}>
                <ChartScatter /> Compare in niche
              </Link>
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="inline-flex rounded-lg">
                  <Button size="lg" disabled aria-disabled>
                    <RefreshCw /> Re-run analysis
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>coming soon</TooltipContent>
            </Tooltip>
          </div>
        </div>
        {d.snapshot.partial ? (
          <Warning>
            Partial capture{d.snapshot.partialReason ? `: ${d.snapshot.partialReason}` : ''}. Numbers below only cover what was read.
          </Warning>
        ) : null}
      </header>

      <KpiStrip s={summary} />
      <KeyPoints entry={entry} summary={summary} rows={rows} />
      <Cohorts entry={entry} rows={rows} />
      <ViewsSection rows={rows} median={medianViewsOf(d)} />
      <HookLab rows={rows} platform={platform} />
      <VideosTable rows={rows} />
    </div>
  )
}

/* ---------------- KPI strip ---------------- */

function KpiStrip({ s }: { s: AccountSummary }) {
  const kpis: { label: string; value: string; hint: string; mock?: boolean; tone?: string }[] = [
    { label: 'Followers', value: fmtCompact(s.followers), hint: 'From the profile header' },
    { label: 'Median views', value: fmtCompact(s.medianViews), hint: `Across ${s.itemsWithViews} items with a view count` },
    { label: 'Views / follower', value: fmtRatio(s.viewsPerFollower), hint: 'Median views divided by followers' },
    { label: 'Hit rate', value: fmtPct(s.hitRate, 0), hint: 'Share of items above 3× the median', tone: 'text-brand' },
    { label: 'Share rate', value: fmtPct(s.shareRate, 2), hint: 'Median of per-item shares / views' },
    { label: 'Avg delay after news', value: '—', hint: 'Needs event dates from the Story radar' },
    { label: 'Posts / week', value: fmtNum(s.postsPerWeek, 2), hint: 'From item dates in the capture window' },
  ]
  return (
    <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
      {kpis.map((k) => (
        <Tooltip key={k.label}>
          <TooltipTrigger asChild>
            <div tabIndex={0} className="min-w-0 rounded-2xl border border-line bg-surface px-4 py-3 outline-none focus-visible:border-violet">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-xs text-dim">{k.label}</p>
                {k.mock ? <span className="size-1.5 shrink-0 rounded-full bg-amber" aria-label="mock data" /> : null}
              </div>
              <p className={cn('num mt-1.5 text-xl font-medium', k.value === NA ? 'text-dim' : (k.tone ?? 'text-fg'))}>{k.value}</p>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {k.hint}
            {k.mock ? ' (mock data)' : ''}
          </TooltipContent>
        </Tooltip>
      ))}
    </section>
  )
}

/* ---------------- Key points ---------------- */

function KeyPoints({ entry, summary, rows }: { entry: ReportEntry; summary: AccountSummary; rows: ItemRow[] }) {
  const d = entry.data
  const real = d.insights.length > 0
  const points = real ? d.insights.slice(0, 4) : accountExtrasMock.keyPoints.points
  const verdict = real
    ? isNum(summary.hitRate) && isNum(summary.medianViews)
      ? `${fmtPct(summary.hitRate, 0)} of videos break 3× the median of ${fmtCompact(summary.medianViews)} views; ${d.insights[0].title.toLowerCase()} is the strongest pattern.`
      : d.insights[0].title
    : accountExtrasMock.keyPoints.verdict
  const jev = (['theme', 'format', 'news'] as const).map((k) => jevCohort(d, rows, k)).filter((c): c is Cohort => c !== null)
  const derived = copyAvoidFrom(jev, medianViewsOf(d))
  const realCopy = jev.length > 0
  const { copy, avoid } = realCopy ? derived : accountExtrasMock.copyAvoid
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">Key points</h2>
          {!real ? <MockBadge /> : null}
        </div>
        {!real && d.insightNotice ? <p className="mt-1 text-xs text-dim">{d.insightNotice}</p> : null}
        <p className="mt-3 font-display text-base leading-snug text-fg sm:text-lg">{verdict}</p>
        <ol className="mt-5 grid gap-4 md:grid-cols-2">
          {points.map((p, i) => (
            <li key={`${p.title}-${i}`} className="flex min-w-0 gap-3">
              <span className="num grid size-6 shrink-0 place-items-center rounded-md border border-line bg-surface-2 text-xs text-brand">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{p.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-dim">{p.body}</p>
                {p.sources.length ? (
                  <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {p.sources.map((src, j) => (
                      <ExtLink key={src} href={src}>
                        source {j + 1}
                      </ExtLink>
                    ))}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </Panel>
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">What to copy / avoid</h2>
          {realCopy ? null : <MockBadge />}
        </div>
        {realCopy ? <p className="mt-1 text-xs text-dim">From Jev cohorts: 2+ videos at ≥1.5× or &lt;0.5× the median.</p> : null}
        {realCopy && !copy.length && !avoid.length ? <p className="mt-4 text-sm text-dim">No group stands out yet. Collect more videos.</p> : null}
        <ul className="mt-4 space-y-2">
          {copy.map((c) => (
            <li key={c} className="flex gap-2 text-sm text-fg/90">
              <ThumbsUp className="mt-0.5 size-4 shrink-0 text-good" aria-label="copy" /> {c}
            </li>
          ))}
        </ul>
        <div className="my-4 h-px bg-line" />
        <ul className="space-y-2">
          {avoid.map((c) => (
            <li key={c} className="flex gap-2 text-sm text-fg/90">
              <ThumbsDown className="mt-0.5 size-4 shrink-0 text-brand" aria-label="avoid" /> {c}
            </li>
          ))}
        </ul>
      </Panel>
    </section>
  )
}

/* ---------------- Cohorts ---------------- */

const COHORT_COLORS: Record<string, string[]> = {
  theme: [T.violet],
  format: [T.cyan],
  timing: [T.amber],
  news: [T.amber],
  tier: [T.accent, T.violet, T.muted, T.line],
}

function Cohorts({ entry, rows }: { entry: ReportEntry; rows: ItemRow[] }) {
  const [metric, setMetric] = useState<CohortMetric>('medianViews')
  const [themeC, formatC, timingC] = accountExtrasMock.cohorts
  const real = (['theme', 'format', 'news'] as const).map((k) => jevCohort(entry.data, rows, k))
  // Real Jev cohorts replace the mocks once the account is classified (`jev-social reports classify`).
  const cohorts = real.every(Boolean)
    ? [...(real as Cohort[]), tierCohort(entry.data, rows)]
    : [themeC, formatC, timingC, tierCohort(entry.data, rows)]
  return (
    <section className="space-y-4">
      <SectionTitle
        title="Cohorts"
        hint="What separates the hits from the rest"
        right={
          <ToggleGroup
            type="single"
            value={metric}
            onValueChange={(v) => v && setMetric(v as CohortMetric)}
            variant="outline"
            size="sm"
            aria-label="Cohort metric"
            className="flex-wrap"
          >
            {(Object.keys(METRIC_LABEL) as CohortMetric[]).map((m) => (
              <ToggleGroupItem key={m} value={m} className="px-3 text-xs data-[state=on]:bg-surface-2 data-[state=on]:text-fg">
                {METRIC_LABEL[m]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      <div className="grid gap-4 md:grid-cols-2">
        {cohorts.map((c) => (
          <Panel key={c.kind} className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-fg">{c.title}</h3>
                <p className="text-xs text-dim">{c.subtitle}</p>
              </div>
              {c.mock ? <MockBadge /> : <span className="rounded-full border border-good/40 bg-good/10 px-2 text-[11px] text-good">real</span>}
            </div>
            <div className="mt-3">
              {c.buckets.every((b) => b.count === 0) ? (
                <EmptyState title="No data" body="No view counts captured for this account." className="py-6" />
              ) : (
                <CohortBars cohort={c} metric={metric} colors={COHORT_COLORS[c.kind]} />
              )}
            </div>
            <p className="mt-2 border-t border-line pt-3 text-sm text-fg/85">{c.takeaway}</p>
          </Panel>
        ))}
      </div>
    </section>
  )
}

/* ---------------- Views chart ---------------- */

function ViewsSection({ rows, median }: { rows: ItemRow[]; median: number | null }) {
  const withViews = rows.filter((r) => isNum(r.views)).length
  return (
    <Panel className="p-5 sm:p-6">
      <SectionTitle
        title="Views per video"
        hint={
          withViews < rows.length
            ? `${withViews} of ${rows.length} videos have a view count. In capture order, newest first.`
            : 'In capture order, newest first.'
        }
        right={
          <div className="flex items-center gap-3 text-xs text-dim">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-brand" /> hit &gt;3×
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-violet/75" /> other
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm bg-line" /> flop
            </span>
          </div>
        }
      />
      <div className="mt-4">
        {withViews ? <ViewsChart rows={rows} median={median} /> : <EmptyState title="No view counts captured" body="This capture only read item URLs." />}
      </div>
    </Panel>
  )
}

/* ---------------- Hook lab ---------------- */

function HookLab({ rows, platform }: { rows: ItemRow[]; platform: string }) {
  const byViews = rows.filter((r) => isNum(r.views)).sort((a, b) => (b.views as number) - (a.views as number))
  const analysed = byViews.filter((r) => r.media?.hookType)
  const real = analysed.length > 0
  // Real: the analysed videos (top + flops chosen by `jev-social media`), best 3 and weakest 2.
  const hits = (real ? analysed : byViews.filter((r) => r.tier === 'hit')).slice(0, 3)
  const flops = (real ? analysed.filter((r) => !hits.includes(r)) : byViews.filter((r) => r.tier === 'flop')).slice(-2).reverse()
  const cards: { row: ItemRow | null; kind: 'hit' | 'flop'; note: { hook: string; firstSeconds: string } }[] = [
    ...[0, 1, 2].map((i) => ({ row: hits[i] ?? null, kind: 'hit' as const, note: accountExtrasMock.hookNotes[i] })),
    ...[0, 1].map((i) => ({ row: flops[i] ?? null, kind: 'flop' as const, note: accountExtrasMock.hookNotes[3 + i] })),
  ].map((c) =>
    c.row?.media?.hookType ? { ...c, note: { hook: jevLabel(c.row.media.hookType), firstSeconds: c.row.media.hookNote ?? '' } } : c,
  )
  const platformName = platform === 'instagram' ? 'Instagram' : platform === 'tiktok' ? 'TikTok' : 'platform'
  return (
    <section className="space-y-4">
      <SectionTitle
        title="Hook lab"
        hint={
          real
            ? 'Frames at 0 / 1 / 2 s, local transcript of the first 3 s, hook read by a vision model.'
            : 'Top 3 hits and the 2 weakest flops. Videos are real; hook notes are placeholders. Run `jev-social media <niche>`.'
        }
        right={real ? null : <MockBadge label="mock hooks" />}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {cards.map(({ row, kind, note }, i) => (
          <Panel as="article" key={`${kind}-${i}`} className="flex flex-col">
            <div className="relative border-b border-line bg-surface-2">
              {row?.media?.frames ? (
                <div className="grid grid-cols-3 gap-px">
                  {Array.from({ length: Math.min(3, row.media.frames) }, (_, n) => (
                    <figure key={n} className="relative">
                      <img
                        src={`/api/media/frame?url=${encodeURIComponent(row.url)}&n=${n}`}
                        alt={`Frame at ${n} s`}
                        loading="lazy"
                        className="aspect-[9/16] w-full object-cover"
                      />
                      <figcaption className="num absolute bottom-1 left-1 rounded bg-bg/70 px-1 text-[10px] text-fg">{n}.0s</figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <div className="grid aspect-[16/6] place-items-center sm:aspect-[16/9]">
                  <Clapperboard className="size-6 text-dim/60" aria-hidden />
                  <span className="absolute bottom-2 left-2 text-[10px] uppercase tracking-wider text-dim">
                    {row?.media?.error ? `media: ${row.media.error}` : 'frame placeholder'}
                  </span>
                </div>
              )}
              <span
                className={cn(
                  'absolute top-2 left-2 rounded-full px-2 py-0.5 text-[11px] font-medium',
                  kind === 'hit' ? 'bg-brand/15 text-brand' : 'bg-amber/15 text-amber',
                )}
              >
                {kind === 'hit' ? `Hit #${(i % 3) + 1}` : `Flop #${i - 2}`}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-4">
              {row ? (
                <>
                  <div className="num flex items-baseline gap-2">
                    <span className="text-lg text-fg">{fmtCompact(row.views)}</span>
                    <span className={cn('text-xs', kind === 'hit' ? 'text-brand' : 'text-amber')}>{fmtRatio(row.xMedian, 1)} median</span>
                  </div>
                  <p className="line-clamp-2 text-sm break-words text-fg/85">{row.caption ?? <span className="text-dim italic">Caption not read</span>}</p>
                </>
              ) : (
                <p className="text-sm text-dim">No {kind === 'hit' ? 'hit' : 'flop'} in this capture.</p>
              )}
              <div className={cn('mt-auto rounded-lg border p-2.5', row?.media?.hookType ? 'border-line' : 'border-dashed border-line')}>
                <p className="text-xs font-medium text-fg">hook: {note.hook}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-dim">{note.firstSeconds}</p>
                {row?.media?.head ? <p className="mt-1 text-xs text-dim italic">“{row.media.head}”</p> : null}
              </div>
              {row ? (
                <ExtLink href={row.url} className="text-xs">
                  Open on {platformName}
                </ExtLink>
              ) : null}
            </div>
          </Panel>
        ))}
      </div>
    </section>
  )
}

/* ---------------- All videos ---------------- */

type SortKey = 'index' | 'views' | 'xMedian' | 'likeRate' | 'shareRate' | 'createdAt'

const COLS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'views', label: 'Views', align: 'right' },
  { key: 'xMedian', label: '× median', align: 'right' },
  { key: 'likeRate', label: 'Like rate', align: 'right' },
  { key: 'shareRate', label: 'Share rate', align: 'right' },
  { key: 'createdAt', label: 'Date', align: 'right' },
]

function sortValue(r: ItemRow, k: SortKey): number | null {
  if (k === 'createdAt') return r.createdAt ? Date.parse(r.createdAt) : null
  if (k === 'index') return r.index
  return r[k]
}

const TIER_TEXT: Record<Tier, string> = { hit: 'text-brand', flop: 'text-amber', above: 'text-fg', below: 'text-fg', unknown: 'text-dim' }

function VideosTable({ rows }: { rows: ItemRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'views', dir: -1 })
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      const va = sortValue(a, sort.key)
      const vb = sortValue(b, sort.key)
      if (va === null && vb === null) return a.index - b.index
      if (va === null) return 1 // nulls always last
      if (vb === null) return -1
      return (va - vb) * sort.dir
    })
  }, [rows, sort])
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: -1 }))
  const classified = rows.some((r) => r.jev)
  const tagsOf = (r: ItemRow) =>
    r.jev
      ? { theme: jevLabel(r.jev.theme.value), format: jevLabel(r.jev.format.value), mock: false }
      : classified
        ? null
        : { ...accountExtrasMock.tagPool[r.index % accountExtrasMock.tagPool.length], mock: true }

  const SortIcon = ({ k }: { k: SortKey }) =>
    sort.key !== k ? <ArrowUpDown className="size-3 opacity-50" /> : sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />

  return (
    <section className="space-y-4">
      <SectionTitle
        title="All videos"
        hint={`${rows.length} videos in this capture`}
        right={
          <label className="flex items-center gap-2 text-xs text-dim md:hidden">
            Sort
            <select
              value={`${sort.key}:${sort.dir}`}
              onChange={(e) => {
                const [key, dir] = e.target.value.split(':')
                setSort({ key: key as SortKey, dir: Number(dir) as 1 | -1 })
              }}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-fg"
            >
              <option value="views:-1">Views ↓</option>
              <option value="xMedian:-1">× median ↓</option>
              <option value="shareRate:-1">Share rate ↓</option>
              <option value="likeRate:-1">Like rate ↓</option>
              <option value="createdAt:-1">Newest</option>
              <option value="index:1">Capture order</option>
            </select>
          </label>
        }
      />
      {rows.length === 0 ? (
        <Panel>
          <EmptyState title="No videos captured" body="The profile grid was empty or could not be read." />
        </Panel>
      ) : (
        <>
          {/* Desktop table */}
          <Panel className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-dim">
                    <th className="w-10 px-4 py-3 font-medium">#</th>
                    <th className="px-2 py-3 font-medium">Caption</th>
                    <th className="px-2 py-3 font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        Theme / format {!classified ? <span className="size-1.5 rounded-full bg-amber" title="mock data" /> : null}
                      </span>
                    </th>
                    {COLS.map((c) => (
                      <th key={c.key} className="px-2 py-3 text-right font-medium" aria-sort={sort.key === c.key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
                        <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 rounded hover:text-fg focus-visible:outline-2 focus-visible:outline-violet">
                          {c.label} <SortIcon k={c.key} />
                        </button>
                      </th>
                    ))}
                    <th className="w-10 px-4 py-3" aria-label="Link" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const t = tagsOf(r)
                    return (
                      <tr key={r.url} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
                        <td className="num px-4 py-3 text-xs text-dim">{r.index + 1}</td>
                        <td className="max-w-[340px] px-2 py-3">
                          <div className="flex items-center gap-2">
                            <span className={cn('truncate', r.caption ? 'text-fg/90' : 'text-dim italic')}>{r.caption ?? 'Caption not read'}</span>
                            {!r.detailCaptured ? <NotRead /> : null}
                          </div>
                        </td>
                        <td className="px-2 py-3">
                          {t ? (
                            <div className="flex gap-1">
                              <Chip>{t.theme}</Chip>
                              <Chip className="text-dim">{t.format}</Chip>
                            </div>
                          ) : (
                            <span className="text-xs text-dim italic">not classified</span>
                          )}
                        </td>
                        <td className="num px-2 py-3 text-right text-fg">{fmtCompact(r.views)}</td>
                        <td className={cn('num px-2 py-3 text-right', TIER_TEXT[r.tier])}>{fmtRatio(r.xMedian, 1)}</td>
                        <td className="num px-2 py-3 text-right">{fmtPct(r.likeRate)}</td>
                        <td className="num px-2 py-3 text-right">{fmtPct(r.shareRate, 2)}</td>
                        <td className="num px-2 py-3 text-right whitespace-nowrap text-dim">{fmtDate(r.createdAt)}</td>
                        <td className="px-4 py-3 text-right">
                          <ExtLink href={r.url} iconOnly />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>

          {/* Mobile cards */}
          <ul className="space-y-3 md:hidden">
            {sorted.map((r) => {
              const t = tagsOf(r)
              return (
                <li key={r.url} className="min-w-0 rounded-2xl border border-line bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className={cn('line-clamp-2 min-w-0 text-sm break-words', r.caption ? 'text-fg/90' : 'text-dim italic')}>
                      <span className="num mr-1.5 text-xs text-dim not-italic">#{r.index + 1}</span>
                      {r.caption ?? 'Caption not read'}
                    </p>
                    <ExtLink href={r.url} iconOnly className="shrink-0 p-1" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    {t ? (
                      <>
                        <Chip>{t.theme}</Chip>
                        <Chip className="text-dim">{t.format}</Chip>
                        {t.mock ? <span className="size-1.5 rounded-full bg-amber" aria-label="tags are mock data" /> : null}
                      </>
                    ) : (
                      <span className="text-xs text-dim italic">not classified</span>
                    )}
                    {!r.detailCaptured ? <NotRead /> : null}
                  </div>
                  <dl className="num mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                    <MiniStat label="Views" value={fmtCompact(r.views)} />
                    <MiniStat label="× median" value={fmtRatio(r.xMedian, 1)} cls={TIER_TEXT[r.tier]} />
                    <MiniStat label="Date" value={fmtDate(r.createdAt)} />
                    <MiniStat label="Like rate" value={fmtPct(r.likeRate)} />
                    <MiniStat label="Share rate" value={fmtPct(r.shareRate, 2)} />
                  </dl>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

function MiniStat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-sans text-[11px] text-dim">{label}</dt>
      <dd className={cn('truncate', value === NA ? 'text-dim' : (cls ?? 'text-fg'))}>{value}</dd>
    </div>
  )
}

function NotRead() {
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-md border border-line px-1.5 text-[11px] text-dim" title="Detail page not read: only grid-level data">
      <EyeOff className="size-3" aria-hidden /> not read
    </span>
  )
}
