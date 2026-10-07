import { useEffect, useState } from 'react'
import { Chip, ExtLink, Panel, Warning } from '@/components/kit'
import { useRadar } from '@/components/LiveRadar'
import { plannedFrom, type CalendarTable } from '@/components/Pilot'
import { fold, score, SCORED } from '@/lib/pilot'
import { cn } from '@/lib/utils'

/** Kanban of the series backlog: `Backlog.md` in the series folder (one row = one card, `Colonne` = column). */

const COLUMNS = [
  { key: 'idea', title: 'Idea' },
  { key: 'exploration', title: 'Exploration' },
  { key: 'go-nogo', title: 'GO / NO GO · in progress' },
  { key: 'review', title: 'Analyse & review' },
  { key: 'archive', title: 'Abandoned (archive)' },
  { key: 'done', title: 'Done' },
] as const

type Row = Record<string, string>

function Card({ c, pilot }: { c: Row; pilot?: number | null }) {
  return (
    <Panel as="article" className="space-y-2 p-3">
      <p className="text-sm font-medium text-fg">{c['Carte']}</p>
      <div className="flex flex-wrap gap-1.5">
        {c['Dossier'] ? <Chip>{c['Dossier']}</Chip> : null}
        {c['Date cible'] ? <Chip className="num">{c['Date cible']}</Chip> : null}
        {pilot !== undefined && pilot !== null ? (
          <Chip className="num">
            Pilot {pilot}/{SCORED.length}
          </Chip>
        ) : null}
      </div>
      {c['Prochaine action'] && c['Prochaine action'] !== '—' ? <p className="text-xs text-fg/85">→ {c['Prochaine action']}</p> : null}
      {c['Preuve / note'] ? <p className="text-xs text-dim">{c['Preuve / note']}</p> : null}
    </Panel>
  )
}

export function BacklogPage() {
  const [data, setData] = useState<{ cards: Row[]; folders: string[] } | null>(null)
  const [calendar, setCalendar] = useState<CalendarTable[]>([])
  const radar = useRadar()
  useEffect(() => {
    fetch('/api/backlog')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(setData, () => setData({ cards: [], folders: [] }))
    fetch('/api/calendar')
      .then((r) => (r.ok ? r.json() : []))
      .then(setCalendar, () => {})
  }, [])

  if (!data) return <p className="text-sm text-dim">Loading backlog…</p>

  const known = new Set(COLUMNS.map((c) => c.key))
  const unsorted = data.folders.filter((f) => !data.cards.some((c) => c['Dossier'] === f))
  const badColumn = data.cards.filter((c) => !known.has(c['Colonne'] as (typeof COLUMNS)[number]['key']))
  const planned = plannedFrom(calendar)
  const pilotOf = (c: Row) => {
    const p = planned.find((x) => x.story === c['Dossier'] && x.date === c['Date cible'])
    return p ? score(p.features).pass : null
  }
  // Radar stories not yet on the board, as suggested ideas (matched on the card title, accent-free).
  const titles = data.cards.map((c) => fold(c['Carte']))
  const suggested = (radar ?? []).filter((s) => !titles.some((t) => s.cast.every((name) => t.includes(name)))).slice(0, 4)

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold sm:text-3xl">Backlog</h1>
        <p className="max-w-2xl text-sm text-dim">
          Foot Manga Drama (@moneytime.ai). Edit <code className="num text-fg">drama/foot-manga-drama/Backlog.md</code> and change a card's <code className="num text-fg">Colonne</code> to move it,
          then reload.
        </p>
      </header>

      {unsorted.length ? <Warning>Story folders not on the board: {unsorted.join(' · ')}. Add a row for each in Backlog.md.</Warning> : null}
      {badColumn.length ? (
        <Warning>
          Unknown column on: {badColumn.map((c) => `${c['Carte']} (“${c['Colonne']}”)`).join(' · ')}. Use {[...known].join(', ')}.
        </Warning>
      ) : null}

      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="grid min-w-[1200px] grid-cols-6 gap-3">
          {COLUMNS.map((col) => {
            const cards = data.cards.filter((c) => c['Colonne'] === col.key)
            return (
              <section key={col.key} className="min-w-0 space-y-2 rounded-2xl border border-line bg-surface-2/40 p-2" aria-label={col.title}>
                <h2 className="flex items-center justify-between px-1 pt-1 text-sm font-semibold text-fg">
                  {col.title}
                  <span className="num text-xs text-dim">{cards.length + (col.key === 'idea' ? suggested.length : 0)}</span>
                </h2>
                {cards.map((c) => (
                  <Card key={c['Carte']} c={c} pilot={pilotOf(c)} />
                ))}
                {col.key === 'idea'
                  ? suggested.map((s) => (
                      <Panel as="article" key={s.id} className={cn('space-y-1.5 border-dashed p-3 opacity-80')}>
                        <ExtLink href={s.link} className="text-sm">
                          {s.title}
                        </ExtLink>
                        <div className="flex flex-wrap gap-1.5">
                          <Chip>from radar · {s.score}</Chip>
                          {s.cast.map((n) => (
                            <Chip key={n}>{n}</Chip>
                          ))}
                        </div>
                      </Panel>
                    ))
                  : null}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
