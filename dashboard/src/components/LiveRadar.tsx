import { useEffect, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { Chip, ExtLink, Panel, ScoreBar, SectionTitle } from '@/components/kit'
import { fmtDate } from '@/lib/format'
import { T } from '@/lib/tokens'

/** One story from `jev-social radar` (served by /api/radar). Jev levels are "0".."3". */
export interface RadarStory {
  id: string
  title: string
  link: string
  summary: string
  cast: string[]
  jev: { is_football: string; drama: string; manga: string; characters: string; verifiability: string; emotion: string; risk: string }
  score: number
  items: number
  sources: string[]
  sourceCount: number
  firstSeen: string | null
  lastSeen: string | null
}

export function useRadar(): RadarStory[] | null {
  const [stories, setStories] = useState<RadarStory[] | null>(null)
  useEffect(() => {
    fetch('/api/radar')
      .then((r) => (r.ok ? r.json() : []))
      .then(setStories, () => setStories([]))
  }, [])
  return stories
}

const level = (v: string) => Math.round((Number(v) / 3) * 100)
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function StoryCard({ s, compact }: { s: RadarStory; compact?: boolean }) {
  return (
    <Panel as="article" className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <ExtLink href={s.link} className="font-medium">
            {s.title}
          </ExtLink>
          <p className="mt-1 text-xs text-dim">
            {s.sourceCount} source{s.sourceCount > 1 ? 's' : ''} · {s.items} article{s.items > 1 ? 's' : ''} · last {fmtDate(s.lastSeen)}
            {compact ? null : <> · {s.sources.join(', ')}</>}
          </p>
        </div>
        <p className="num shrink-0 text-2xl font-semibold text-fg" title="Radar priority 0–100">
          {s.score}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {s.cast.map((c) => (
          <Chip key={c}>{cap(c)}</Chip>
        ))}
        <Chip>{s.jev.verifiability}</Chip>
        {s.jev.emotion !== 'none' ? <Chip>{s.jev.emotion}</Chip> : null}
        {s.jev.risk === '1' ? (
          <span className="inline-flex h-5 items-center gap-1 rounded-md border border-amber/40 bg-amber/10 px-1.5 text-[11px] text-amber">
            <ShieldAlert className="size-3" aria-hidden /> legal / reputation risk
          </span>
        ) : null}
      </div>
      {compact ? null : (
        <div className="grid grid-cols-3 gap-3">
          <ScoreBar label="Drama" value={level(s.jev.drama)} color={T.accent} />
          <ScoreBar label="Manga arc" value={level(s.jev.manga)} color={T.violet} />
          <ScoreBar label="Clear cast" value={level(s.jev.characters)} color={T.cyan} />
        </div>
      )}
    </Panel>
  )
}

export function LiveRadar({ stories }: { stories: RadarStory[] }) {
  const heat = new Map<string, { stories: number; items: number }>()
  for (const s of stories) {
    for (const c of s.cast) {
      const h = heat.get(c) ?? { stories: 0, items: 0 }
      heat.set(c, { stories: h.stories + 1, items: h.items + s.items })
    }
  }
  const ranked = [...heat].sort((a, b) => b[1].items - a[1].items).slice(0, 12)
  const maxItems = ranked[0]?.[1].items ?? 1

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold sm:text-3xl">Story radar</h1>
        <p className="max-w-2xl text-sm text-dim">
          Football news from the last 72 h (BBC Sport, Sky Sports, ESPN, Google News per cast member), grouped into stories and scored by Jev on drama, manga arc and
          clear cast. Refresh with <code className="num text-fg">npm start -- radar</code>.
        </p>
      </header>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {stories.map((s) => (
            <StoryCard key={s.id} s={s} />
          ))}
        </div>
        <Panel className="h-fit space-y-3 p-5">
          <SectionTitle title="Cast heat" hint="Articles naming each cast member, last 72 h" />
          <ul className="space-y-2.5">
            {ranked.map(([name, h]) => (
              <li key={name}>
                <ScoreBar label={`${cap(name)} · ${h.stories} stories`} value={Math.round((h.items / maxItems) * 100)} color={T.amber} />
              </li>
            ))}
          </ul>
          <p className="text-xs text-dim">Bars are relative to the most-covered name.</p>
        </Panel>
      </div>
    </div>
  )
}
