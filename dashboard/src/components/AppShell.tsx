import { useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useOutletContext, useParams } from 'react-router'
import { ChartColumn, ChartScatter, Menu, Radar, RefreshCw, ServerCrash } from 'lucide-react'
import { groupNiches, useReportsLoader, type NicheInfo } from '@/lib/api'
import { splitAccount } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, Panel, PlatformPill } from './kit'
import type { ReportEntry } from '@/types'

export interface ShellContext {
  reports: ReportEntry[]
  niches: NicheInfo[]
}

export function useShell(): ShellContext {
  return useOutletContext<ShellContext>()
}

function navCls(active: boolean) {
  return cn(
    'group flex min-h-9 w-full min-w-0 items-center gap-2 rounded-lg px-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-violet',
    active ? 'bg-surface-2 text-fg shadow-[inset_2px_0_0_var(--accent)]' : 'text-dim hover:bg-surface-2/60 hover:text-fg',
  )
}

function SidebarNav({ niches, onNavigate }: { niches: NicheInfo[]; onNavigate?: () => void }) {
  const params = useParams()
  const { pathname } = useLocation()
  const current = niches.find((n) => n.niche === params.niche) ?? niches[0]
  const accountTarget = params.account ?? current?.accounts[0]?.account
  return (
    <nav className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-3 pb-6" aria-label="Main">
      <div>
        <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-dim">Niches</p>
        {niches.length === 0 ? <p className="px-2.5 text-sm text-dim">None yet</p> : null}
        <ul className="space-y-0.5">
          {niches.map((n) => (
            <li key={n.niche}>
              <Link to={`/n/${encodeURIComponent(n.niche)}`} onClick={onNavigate} className={navCls(n.niche === current?.niche && !pathname.startsWith('/radar'))}>
                <span className="min-w-0 flex-1 truncate">{n.niche}</span>
                <span className="num rounded-md bg-bg px-1.5 text-[11px] text-dim">{n.accounts.length}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {current ? (
        <div>
          <p className="truncate px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-dim">Accounts · {current.niche}</p>
          <ul className="space-y-0.5">
            {current.accounts.map((a) => {
              const { platform, handle } = splitAccount(a.account)
              const to = `/n/${encodeURIComponent(current.niche)}/a/${encodeURIComponent(a.account)}`
              return (
                <li key={a.account}>
                  <NavLink to={to} onClick={onNavigate} className={({ isActive }) => navCls(isActive)}>
                    <span className="min-w-0 flex-1 truncate">@{handle}</span>
                    <PlatformPill platform={platform} short />
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}

      <div>
        <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-dim">Views</p>
        <ul className="space-y-0.5">
          <li>
            {current && accountTarget ? (
              <Link to={`/n/${encodeURIComponent(current.niche)}/a/${encodeURIComponent(accountTarget)}`} onClick={onNavigate} className={navCls(Boolean(params.account))}>
                <ChartColumn className="size-4" aria-hidden /> Account analysis
              </Link>
            ) : (
              <span className={cn(navCls(false), 'opacity-50')}>
                <ChartColumn className="size-4" aria-hidden /> Account analysis
              </span>
            )}
          </li>
          <li>
            {current ? (
              <Link to={`/n/${encodeURIComponent(current.niche)}`} onClick={onNavigate} className={navCls(Boolean(params.niche) && !params.account)}>
                <ChartScatter className="size-4" aria-hidden /> Niche comparison
              </Link>
            ) : null}
          </li>
          <li>
            <NavLink to="/radar" onClick={onNavigate} className={({ isActive }) => navCls(isActive)}>
              <Radar className="size-4" aria-hidden /> Story radar
            </NavLink>
          </li>
        </ul>
      </div>
    </nav>
  )
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-violet">
      <span className="grid size-8 place-items-center rounded-lg border border-line bg-surface-2">
        <ChartColumn className="size-4 text-brand" aria-hidden />
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight text-fg">
        Jev Social <span className="text-dim">· Niches</span>
      </span>
    </Link>
  )
}

function LoadingMain() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading reports">
      <Skeleton className="h-8 w-64 bg-surface-2" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl bg-surface" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl bg-surface" />
      <Skeleton className="h-64 rounded-2xl bg-surface" />
    </div>
  )
}

export function AppShell() {
  const state = useReportsLoader()
  const [open, setOpen] = useState(false)
  const niches = useMemo(() => (state.status === 'ready' ? groupNiches(state.reports) : []), [state])
  const ctx: ShellContext | null = state.status === 'ready' ? { reports: state.reports, niches } : null

  return (
    <div className="min-h-dvh bg-bg text-fg lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface lg:flex">
        <div className="px-5 py-5">
          <Brand />
        </div>
        {state.status === 'loading' ? (
          <div className="space-y-2 px-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-7 bg-surface-2" />
            ))}
          </div>
        ) : (
          <SidebarNav niches={niches} />
        )}
      </aside>

      {/* Mobile top bar + drawer */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-bg/95 px-4 backdrop-blur lg:hidden">
        <Brand />
        <Button variant="ghost" size="icon-lg" aria-label="Open navigation" onClick={() => setOpen(true)} className="size-11">
          <Menu className="size-5" />
        </Button>
      </header>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-[84vw] max-w-[300px] border-line bg-surface p-0 pt-5">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Niches, accounts and views</SheetDescription>
          <div className="px-5 pb-4">
            <Brand />
          </div>
          <SidebarNav niches={niches} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1360px]">
          {state.status === 'loading' ? <LoadingMain /> : null}
          {state.status === 'error' ? (
            <Panel className="mx-auto mt-10 max-w-lg">
              <EmptyState
                icon={<ServerCrash className="size-5 text-brand" aria-hidden />}
                title="Could not load reports"
                body={
                  <>
                    {state.message}. The API only runs under <code className="num text-fg">npm run dev</code>; check that the
                    reports folder is readable.
                  </>
                }
              />
              <div className="flex justify-center pb-8">
                <Button variant="outline" onClick={state.reload}>
                  <RefreshCw /> Retry
                </Button>
              </div>
            </Panel>
          ) : null}
          {ctx ? <Outlet context={ctx} /> : null}
        </div>
      </main>
    </div>
  )
}
