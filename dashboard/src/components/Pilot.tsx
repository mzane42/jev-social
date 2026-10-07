import { useEffect, useState } from 'react'
import { Check as CheckIcon, CircleHelp, X } from 'lucide-react'
import { Chip, Panel, SectionTitle, Warning } from '@/components/kit'
import { StoryCard, useRadar } from '@/components/LiveRadar'
import { fold } from '@/lib/pilot'
import { fmtCompact } from '@/lib/format'
import { CHECKS, expected, SCORED, score, type CheckResult, type Features, type Hook, type PastPoint } from '@/lib/pilot'
import { cn } from '@/lib/utils'

export interface CalendarTable {
  section: string
  rows: Record<string, string>[]
}

export interface PastVideo {
  id: string
  title: string
  views: number
  fyp: number
  still2s: number | null
  features?: Features
}

interface Planned {
  date: string
  time: string
  story: string
  episode: string
  features: Features
}

const HOOKS: Hook[] = ['real_moment', 'face', 'closeup', 'title_card', 'recap_card', 'wide', 'black']
const yesNo = (v: string): boolean | null => (/^oui$/i.test(v) ? true : /^non$/i.test(v) ? false : null)
const at = (s: string) => new Date(s.replace(' ', 'T')).getTime() // Paris local on both sides

/** Planned posts = the "Pilotage" table; same-day count comes from the main calendar table. */
export function plannedFrom(tables: CalendarTable[]): Planned[] {
  const pilot = tables.find((t) => t.section.startsWith('Pilotage'))?.rows ?? []
  const posts = tables.flatMap((t) => t.rows).filter((r) => /tiktok/i.test(r['Plateforme'] ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(r['Date'] ?? ''))
  return pilot.map((r) => {
    const date = r['Date']
    const time = r['Heure'] || '12:00'
    const event = r['Événement (date heure)']
    const hook = r['Ouverture 0–1 s'] as Hook
    const sameDay = new Set(posts.filter((p) => p['Date'] === date).map((p) => `${p['Histoire']}\n${p['Épisode']}`)).size
    return {
      date,
      time,
      story: r['Histoire'],
      episode: r['Épisode'],
      features: {
        eventHoursBefore: event ? Math.round((at(event) - at(`${date} ${time}`)) / 36e5) : null,
        captionSearch: yesNo(r['Légende cherchée'] ?? ''),
        hook: HOOKS.includes(hook) ? hook : null,
        deadFrame: yesNo(r['Écran vide 0–2 s'] ?? ''),
        sameDayPosts: Math.max(sameDay, 1),
        lang: r['Langue sous-titres'] || null,
      },
    }
  })
}

function Mark({ r, hypothesis }: { r: CheckResult; hypothesis?: boolean }) {
  if (r === null) return <CircleHelp className="size-4 text-dim" aria-label="not filled in" />
  if (r) return <CheckIcon className="size-4 text-good" aria-label="pass" />
  return <X className={cn('size-4', hypothesis ? 'text-amber' : 'text-brand')} aria-label="fail" />
}

const range = (r: number[] | null, f: (n: number) => string = fmtCompact) => (r ? (r[0] === r[1] ? f(r[0]) : `${f(r[0])}–${f(r[1])}`) : 'n/a')

function PlannedCard({ p, past, now }: { p: Planned; past: PastPoint[]; now: number }) {
  const s = score(p.features)
  const exp = expected(past, s.pass)
  const days = Math.ceil((at(`${p.date} ${p.time}`) - now) / 864e5)
  const todo = CHECKS.filter((c) => s.results[c.key] !== true)
  return (
    <Panel as="article" className="space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-fg">{p.story}</p>
          <p className="text-sm text-dim">{p.episode}</p>
        </div>
        <div className="text-right">
          <p className="num text-xl font-semibold text-fg">
            {s.pass}/{SCORED.length}
          </p>
          <p className="num text-xs text-dim">
            {p.date} {p.time} · {days >= 0 ? `J-${days}` : 'past'}
          </p>
        </div>
      </div>
      <p className="text-xs text-dim">
        Past videos within one check (n = {exp.n}): views <span className="num text-fg">{range(exp.views)}</span> · FYP{' '}
        <span className="num text-fg">{range(exp.fyp)}</span> · still at 2 s <span className="num text-fg">{range(exp.still2s, (n) => `${n}%`)}</span>
      </p>
      {todo.length ? (
        <ul className="space-y-2">
          {todo.map((c) => (
            <li key={c.key} className="flex gap-2 text-sm">
              <Mark r={s.results[c.key]} hypothesis={c.hypothesis} />
              <div className="min-w-0">
                <p className="text-fg">
                  {c.label}
                  {c.hypothesis ? <Chip className="ml-2">hypothesis</Chip> : null}
                  {s.results[c.key] === null ? <Chip className="ml-2">to fill in Calendar.md</Chip> : null}
                </p>
                <p className="text-xs text-dim">{c.fix}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-good">All checks pass.</p>
      )}
    </Panel>
  )
}

export function Pilot({ past }: { past: PastVideo[] }) {
  const [tables, setTables] = useState<CalendarTable[] | null>(null)
  const [now] = useState(() => Date.now())
  const radar = useRadar()
  useEffect(() => {
    fetch('/api/calendar')
      .then((r) => (r.ok ? r.json() : []))
      .then(setTables, () => setTables([]))
  }, [])

  const scoredPast = past.map((v) => ({ ...v, s: score(v.features ?? {}) }))
  const points: PastPoint[] = scoredPast.map((v) => ({ pass: v.s.pass, views: v.views, fyp: v.fyp, still2s: v.still2s }))
  const upcoming = (tables ? plannedFrom(tables) : []).filter((p) => at(`${p.date} ${p.time}`) >= now - 864e5).sort((a, b) => a.date.localeCompare(b.date))
  const th = 'px-2 py-2 text-center text-xs font-medium text-dim'

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Pilot: what to change next"
        hint="Checklist built from what separated Zidane from the rest. Hand-written rules, not a model."
      />
      <Warning>Heuristic from n = {past.length} videos. The score tracks retention at 2 s and search traffic, not FYP views (Ballon d'Or P2 scores 2/5 and is the FYP best). Expected ranges are past outcomes of similar videos, not a forecast.</Warning>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">Planned posts (Calendar.md, Pilotage table)</h3>
        {tables === null ? (
          <p className="text-sm text-dim">Loading calendar…</p>
        ) : upcoming.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {upcoming.map((p) => (
              <PlannedCard key={`${p.date}${p.story}`} p={p} past={points} now={now} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-dim">No upcoming row in the Pilotage table of Calendar.md.</p>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-fg">Next to write (Story radar, last 72 h)</h3>
        <p className="text-xs text-dim">
          Top radar stories. Written today they pass “Timed to the event”; still to decide: caption, opening, subtitles. “Planned” = a cast member already has an upcoming row
          in the Pilotage table.
        </p>
        {radar === null ? (
          <p className="text-sm text-dim">Loading radar…</p>
        ) : radar.length ? (
          <div className="grid gap-3 lg:grid-cols-3">
            {radar.slice(0, 3).map((s) => {
              const already = s.cast.filter((c) => upcoming.some((p) => fold(p.story).includes(c)))
              return (
                <div key={s.id} className="space-y-1">
                  <StoryCard s={s} compact />
                  {already.length ? <Chip>planned: {already.join(', ')}</Chip> : <Chip className="border-good/40 text-good">not in the calendar</Chip>}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-dim">No radar data yet: run <code className="num text-fg">npm start -- radar</code>.</p>
        )}
      </div>

      <Panel className="p-1">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-dim">Published video</th>
                {CHECKS.map((c) => (
                  <th key={c.key} className={th} title={c.label}>
                    {c.label.split(' ').slice(0, 2).join(' ')}
                  </th>
                ))}
                <th className={th}>Score</th>
                <th className={th}>Still at 2 s</th>
                <th className={th}>Views</th>
                <th className={th}>FYP</th>
              </tr>
            </thead>
            <tbody>
              {[...scoredPast]
                .sort((a, b) => b.s.pass - a.s.pass)
                .map((v) => (
                  <tr key={v.id} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap text-fg">{v.title}</td>
                    {CHECKS.map((c) => (
                      <td key={c.key} className="px-2 py-2">
                        <div className="flex justify-center">
                          <Mark r={v.s.results[c.key]} hypothesis={c.hypothesis} />
                        </div>
                      </td>
                    ))}
                    <td className="num px-2 py-2 text-center text-fg">
                      {v.s.pass}/{SCORED.length}
                    </td>
                    <td className="num px-2 py-2 text-center">{v.still2s ?? 'n/a'}%</td>
                    <td className="num px-2 py-2 text-center">{fmtCompact(v.views)}</td>
                    <td className="num px-2 py-2 text-center">{fmtCompact(v.fyp)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel className="space-y-3 p-4">
        <SectionTitle title="Why each check" hint="The evidence row behind every rule (RETEX-MONEYTIME-05-10.md)." />
        <ul className="space-y-3">
          {CHECKS.map((c) => (
            <li key={c.key} className="text-sm">
              <p className="font-medium text-fg">
                {c.label}
                {c.hypothesis ? <Chip className="ml-2">hypothesis, not scored</Chip> : null}
              </p>
              <p className="text-xs text-dim">{c.evidence}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  )
}
