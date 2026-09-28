import { useMemo, useState } from 'react'
import { AtSign, MessagesSquare, Newspaper, PenTool, Tv, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CrossingChart } from '@/components/charts'
import { Chip, EmptyState, MockBadge, Panel, ScoreBar, SectionTitle } from '@/components/kit'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { fmtDate } from '@/lib/format'
import { T } from '@/lib/tokens'
import { cn } from '@/lib/utils'
import { radarMock } from '@/mocks/radar'
import type { StorySource, StoryTag } from '@/types'

const SOURCES: { id: StorySource; label: string; icon: LucideIcon }[] = [
  { id: 'news-rss', label: 'News RSS', icon: Newspaper },
  { id: 'youtube-drama', label: 'YouTube drama', icon: Tv },
  { id: 'x', label: 'X', icon: AtSign },
  { id: 'reddit', label: 'Reddit', icon: MessagesSquare },
]

const TAG_STYLE: Record<StoryTag, string> = {
  HOT: 'border-brand/40 bg-brand/10 text-brand',
  'OPEN ANGLE': 'border-good/40 bg-good/10 text-good',
  MATCH: 'border-violet/40 bg-violet/10 text-violet',
}

export function RadarPage() {
  const [active, setActive] = useState<StorySource[]>(SOURCES.map((s) => s.id))
  const stories = useMemo(() => {
    const total = (s: (typeof radarMock.stories)[number]) => active.reduce((n, id) => n + s.sources[id], 0)
    return radarMock.stories
      .map((s) => ({ ...s, total: total(s) }))
      .filter((s) => s.total > 0)
      .sort((a, b) => b.scores.drama + b.scores.nicheGap - (a.scores.drama + a.scores.nicheGap))
  }, [active])
  const maxHeat = Math.max(...radarMock.characters.map((c) => c.heat))

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold sm:text-3xl">Story radar</h1>
          <MockBadge />
        </div>
        <p className="max-w-2xl text-sm text-dim">
          Football stories with drama momentum, scored for how well they would work as a manga arc and how little the niche has covered them.
        </p>
        <ToggleGroup
          type="multiple"
          value={active}
          onValueChange={(v) => setActive(v as StorySource[])}
          variant="outline"
          size="sm"
          aria-label="Sources"
          className="flex-wrap justify-start"
        >
          {SOURCES.map(({ id, label, icon: Icon }) => (
            <ToggleGroupItem key={id} value={id} className="gap-1.5 px-3 text-xs data-[state=off]:text-dim data-[state=on]:bg-surface-2 data-[state=on]:text-fg">
              <Icon className="size-3.5" aria-hidden /> {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </header>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="space-y-4" aria-label="Stories">
          {stories.length === 0 ? (
            <Panel>
              <EmptyState title="No stories for these sources" body="Turn on at least one source above." />
            </Panel>
          ) : null}
          {stories.map((s) => (
            <Panel as="article" key={s.id} className="p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={cn('rounded-full border px-2 py-0.5 font-medium tracking-wide', TAG_STYLE[s.tag])}>{s.tag}</span>
                <span className="text-dim">{s.category}</span>
                <span className="text-dim" aria-hidden>
                  ·
                </span>
                <span className="num text-dim">first seen {fmtDate(s.firstSeen)}</span>
              </div>
              <h2 className="mt-3 text-lg leading-snug font-semibold break-words">{s.headline}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-dim">{s.summary}</p>

              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Source counts">
                {SOURCES.filter((src) => active.includes(src.id)).map(({ id, label, icon: Icon }) => (
                  <li key={id} className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 text-xs text-dim" title={label}>
                    <Icon className="size-3.5" aria-hidden />
                    <span className="sr-only">{label}</span>
                    <span className="num text-fg">{s.sources[id]}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 rounded-xl border border-line bg-bg/60 p-4">
                <p className="text-[11px] font-medium tracking-wider text-violet uppercase">Manga-arc pitch</p>
                <p className="mt-1.5 text-sm leading-relaxed text-fg/90">{s.arcPitch}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.characters.map((c) => (
                    <Chip key={c}>{c}</Chip>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <ScoreBar label="Drama" value={s.scores.drama} color={T.accent} />
                <ScoreBar label="Manga-ability" value={s.scores.mangaability} color={T.violet} />
                <ScoreBar label="Niche gap" value={s.scores.nicheGap} color={T.cyan} />
              </div>

              <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-dim">{s.coverage}</p>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span tabIndex={0} className="inline-flex shrink-0 rounded-lg">
                      <Button size="lg" disabled aria-disabled>
                        <PenTool /> Draft manga arc
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>coming soon</TooltipContent>
                </Tooltip>
              </div>
            </Panel>
          ))}
        </section>

        <aside className="space-y-4">
          <Panel className="p-5">
            <SectionTitle title="Character bible" hint="Ranked by heat across stories" />
            <ol className="mt-4 space-y-3">
              {radarMock.characters.map((c, i) => (
                <li key={c.name} className="flex items-center gap-3">
                  <span className="num w-5 text-right text-xs text-dim">{i + 1}</span>
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2">
                    <Users className="size-3.5 text-dim" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium">{c.name}</p>
                      <span className="num text-xs text-fg">{c.heat}</span>
                    </div>
                    <p className="text-[11px] text-dim">
                      {c.role} · <span className="num">{c.appearances}</span> stories
                    </p>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-amber" style={{ width: `${(c.heat / maxHeat) * 100}%` }} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
          <Panel className="p-5">
            <SectionTitle title="Crossing the niches" hint="Drama volume vs manga coverage, per category (0–100)" />
            <div className="mt-4">
              <CrossingChart data={radarMock.crossings} />
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  )
}
