import { useMemo } from 'react'
import { Link, useParams } from 'react-router'
import { ChartScatter, EyeOff } from 'lucide-react'
import { useShell } from '@/components/AppShell'
import { NicheCohortChart, NicheScatter, type ScatterPoint } from '@/components/charts'
import { EmptyState, MockBadge, Panel, PlatformPill, SectionTitle, Warning } from '@/components/kit'
import { fmtCompact, fmtDate, fmtNum, fmtPct, fmtRatio, isNum, NA, splitAccount } from '@/lib/format'
import { summarize, type AccountSummary } from '@/lib/metrics'
import { cn } from '@/lib/utils'
import { nicheCohortMock } from '@/mocks/niche'
import type { ReportEntry } from '@/types'
import { NotFound } from './Home'

interface Row {
  entry: ReportEntry
  platform: string
  handle: string
  s: AccountSummary
  read: number
  total: number
}

export function NichePage() {
  const { niche = '' } = useParams()
  const { niches } = useShell()
  const info = niches.find((n) => n.niche === niche)
  const rows: Row[] = useMemo(
    () =>
      (info?.accounts ?? []).map((entry) => ({
        entry,
        ...splitAccount(entry.account),
        s: summarize(entry.data),
        read: entry.data.snapshot.items.filter((i) => i.detailCaptured).length,
        total: entry.data.snapshot.items.length,
      })),
    [info],
  )
  if (!info) return <NotFound what="Niche" />

  const partial = rows.filter((r) => r.entry.data.snapshot.partial)
  const points: ScatterPoint[] = rows.flatMap((r) =>
    isNum(r.s.followers) && isNum(r.s.medianViews) && r.s.followers > 0 && r.s.medianViews > 0
      ? [{ account: r.entry.account, followers: r.s.followers, medianViews: r.s.medianViews, hitRate: r.s.hitRate, platform: r.platform }]
      : [],
  )
  const cohort = nicheCohortMock(rows.map((r) => r.entry.account))
  const accountHref = (r: Row) => `/n/${encodeURIComponent(niche)}/a/${encodeURIComponent(r.entry.account)}`

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="text-xs text-dim">Niche comparison</p>
        <h1 className="text-2xl font-semibold break-words sm:text-3xl">{niche}</h1>
        <p className="text-sm text-dim">
          <span className="num text-fg/80">{rows.length}</span> account{rows.length === 1 ? '' : 's'}, latest capture each
        </p>
        {partial.length ? (
          <Warning>
            <p className="font-medium">Partial capture on {partial.length === rows.length ? 'every account' : `${partial.length} of ${rows.length} accounts`}</p>
            <ul className="mt-1 space-y-0.5 text-xs text-amber/85">
              {partial.map((r) => (
                <li key={r.entry.account} className="break-words">
                  @{r.handle}: {r.entry.data.snapshot.partialReason ?? 'reason not recorded'}
                </li>
              ))}
            </ul>
          </Warning>
        ) : null}
      </header>

      {/* Table */}
      <section className="space-y-4">
        <SectionTitle title="Accounts" hint="Hit = item above 3× the account median. Share rate = median per-item shares / views." />
        {rows.length === 0 ? (
          <Panel>
            <EmptyState title="No accounts in this niche" />
          </Panel>
        ) : (
          <>
            <Panel className="hidden md:block">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs text-dim">
                      <th className="px-4 py-3 font-medium">Account</th>
                      <th className="px-2 py-3 text-right font-medium">Followers</th>
                      <th className="px-2 py-3 text-right font-medium">Median views</th>
                      <th className="px-2 py-3 text-right font-medium">Views/follower</th>
                      <th className="px-2 py-3 text-right font-medium">Hit rate</th>
                      <th className="px-2 py-3 text-right font-medium">Share rate</th>
                      <th className="px-2 py-3 text-right font-medium">Posts/wk</th>
                      <th className="px-2 py-3 text-right font-medium">Read</th>
                      <th className="px-4 py-3 text-right font-medium">Captured</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.entry.account} className="border-b border-line/60 last:border-0 hover:bg-surface-2/50">
                        <td className="px-4 py-3">
                          <Link to={accountHref(r)} className="flex min-w-0 items-center gap-2 hover:text-cyan">
                            <PlatformPill platform={r.platform} short />
                            <span className="truncate font-medium">@{r.handle}</span>
                          </Link>
                        </td>
                        <Num v={fmtCompact(r.s.followers)} />
                        <Num v={fmtCompact(r.s.medianViews)} />
                        <Num v={fmtRatio(r.s.viewsPerFollower)} />
                        <Num v={fmtPct(r.s.hitRate, 0)} cls="text-brand" />
                        <Num v={fmtPct(r.s.shareRate, 2)} />
                        <Num v={fmtNum(r.s.postsPerWeek, 2)} />
                        <td className="num px-2 py-3 text-right">
                          <span className={cn(r.read === 0 && 'inline-flex items-center gap-1 text-dim')}>
                            {r.read === 0 ? <EyeOff className="size-3" aria-hidden /> : null}
                            {r.read}/{r.total}
                          </span>
                        </td>
                        <td className="num px-4 py-3 text-right whitespace-nowrap text-dim">{fmtDate(r.entry.data.snapshot.capturedAt ?? r.entry.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
            <ul className="space-y-3 md:hidden">
              {rows.map((r) => (
                <li key={r.entry.account}>
                  <Link to={accountHref(r)} className="block min-w-0 rounded-2xl border border-line bg-surface p-4 transition-colors hover:border-violet/50">
                    <div className="flex items-center gap-2">
                      <PlatformPill platform={r.platform} short />
                      <span className="min-w-0 truncate font-medium">@{r.handle}</span>
                      {r.entry.data.snapshot.partial ? <span className="ml-auto shrink-0 text-[11px] text-amber">partial</span> : null}
                    </div>
                    <dl className="num mt-3 grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                      <Mini label="Followers" v={fmtCompact(r.s.followers)} />
                      <Mini label="Median views" v={fmtCompact(r.s.medianViews)} />
                      <Mini label="Views/fol." v={fmtRatio(r.s.viewsPerFollower)} />
                      <Mini label="Hit rate" v={fmtPct(r.s.hitRate, 0)} />
                      <Mini label="Share rate" v={fmtPct(r.s.shareRate, 2)} />
                      <Mini label="Read" v={`${r.read}/${r.total}`} />
                    </dl>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-5 sm:p-6">
          <SectionTitle title="Followers vs median views" hint="Log scales. Bubble size = hit rate. Cyan TikTok, violet Instagram." />
          <div className="mt-4">
            {points.length ? (
              <NicheScatter points={points} />
            ) : (
              <EmptyState icon={<ChartScatter className="size-5" aria-hidden />} title="Nothing to plot yet" body="An account needs both a follower count and a median view count to appear here." />
            )}
          </div>
          {points.length && points.length < rows.length ? (
            <p className="mt-2 text-xs text-dim">
              {rows.length - points.length} account{rows.length - points.length === 1 ? '' : 's'} hidden: missing followers or views.
            </p>
          ) : null}
        </Panel>
        <Panel className="p-5 sm:p-6">
          <SectionTitle title="Cohort comparison" hint={cohort.title} right={<MockBadge />} />
          <div className="mt-4">{rows.length ? <NicheCohortChart comparison={cohort} /> : <EmptyState title="No accounts" />}</div>
        </Panel>
      </div>
    </div>
  )
}

function Num({ v, cls }: { v: string; cls?: string }) {
  return <td className={cn('num px-2 py-3 text-right', v === NA ? 'text-dim' : (cls ?? 'text-fg'))}>{v}</td>
}

function Mini({ label, v }: { label: string; v: string }) {
  return (
    <div className="min-w-0">
      <dt className="font-sans text-[11px] text-dim">{label}</dt>
      <dd className={cn('truncate', v === NA ? 'text-dim' : 'text-fg')}>{v}</dd>
    </div>
  )
}
