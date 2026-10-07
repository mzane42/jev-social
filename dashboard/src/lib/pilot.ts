/**
 * "Zidane pattern" checklist for our own posts, past and planned.
 * ponytail: hand-written rules from n = 6 videos (RETEX-MONEYTIME-05-10.md), not a model.
 * Replace with cohorts per feature once an account has n >= 8 per arm (GUIDE-LOCAL §7).
 */

export type Hook = 'real_moment' | 'face' | 'closeup' | 'title_card' | 'recap_card' | 'wide' | 'black'

export interface Features {
  hook?: Hook | null
  /** Hours between the post and its event or news; negative = posted after the news. */
  eventHoursBefore?: number | null
  captionSearch?: boolean | null
  deadFrame?: boolean | null
  sameDayPosts?: number | null
  lang?: string | null
}

export type CheckResult = boolean | null // null = not filled in yet

export interface Check {
  key: string
  label: string
  /** What to change when the check fails. */
  fix: string
  evidence: string
  hypothesis?: boolean
  test: (f: Features) => CheckResult
}

const known = <T,>(v: T | null | undefined): v is T => v !== null && v !== undefined

export const CHECKS: Check[] = [
  {
    key: 'timing',
    label: 'Timed to the event',
    fix: 'Post between 36 h before and 6 h after the event or news.',
    evidence: 'Zidane, posted ~30 h before the match: 84% of views from search. The Last Legends, 4 days after the news: search 3–4%.',
    test: (f) => (known(f.eventHoursBefore) ? f.eventHoursBefore <= 36 && f.eventHoursBefore >= -6 : null),
  },
  {
    key: 'caption',
    label: 'Caption opens with a searched phrase',
    fix: 'Start the caption with what people type (“Barcelona vs Real Madrid…”, “Zidane coach France…”).',
    evidence: 'Zidane: searches “france vs italy”, “zidane coach france” matched its caption. Man City (16% search) also opened on “115 charges”.',
    test: (f) => (known(f.captionSearch) ? f.captionSearch : null),
  },
  {
    key: 'opening',
    label: 'Recognizable real moment or full-frame face at 0–1 s',
    fix: 'Open on a face filling the frame or a real moment everyone knows; move wide shots and title cards after 2 s.',
    evidence: 'Still watching at 2 s: Zidane (real 2006 moment) 65%, face/recap over faces 54%, title card 46%, wide night shot 36%, black screen 31%.',
    test: (f) => (known(f.hook) ? ['real_moment', 'face', 'closeup'].includes(f.hook) : null),
  },
  {
    key: 'dead',
    label: 'No empty or black frame at 0–2 s',
    fix: 'Cut the black card; put any “previously” text over a face.',
    evidence: 'The Last Legends P2 (2 s black « 前回 »): 50% gone at 1 s, 3.8 s average watch, worst of the account.',
    test: (f) => (known(f.deadFrame) ? !f.deadFrame : null),
  },
  {
    key: 'oneADay',
    label: 'One post that day',
    fix: 'Move the other post to another day.',
    evidence: 'The Last Legends P1 and P2 on the same day: 222 and 252 FYP views, both at the bottom.',
    test: (f) => (known(f.sameDayPosts) ? f.sameDayPosts <= 1 : null),
  },
  {
    key: 'lang',
    label: 'Subtitles match the FYP audience (FR)',
    fix: 'Test French subtitles and caption: For You sends us ~80% French-speaking viewers.',
    evidence: 'FYP viewers FR+BE+CH ≈ 80% on all 5 non-search videos; all 6 were in EN, so this is untested.',
    hypothesis: true,
    test: (f) => (known(f.lang) ? f.lang === 'FR' : null),
  },
]

/** Proven checks only: the hypothesis does not count in the score. */
export const SCORED = CHECKS.filter((c) => !c.hypothesis)

export function score(f: Features): { pass: number; known: number; results: Record<string, CheckResult> } {
  const results = Object.fromEntries(CHECKS.map((c) => [c.key, c.test(f)]))
  const scored = SCORED.map((c) => results[c.key])
  return { pass: scored.filter((r) => r === true).length, known: scored.filter((r) => r !== null).length, results }
}

export interface PastPoint {
  pass: number
  views: number
  fyp: number
  still2s: number | null
}

/** Range of past outcomes for videos within one check of `pass`. */
export function expected(past: PastPoint[], pass: number) {
  const near = past.filter((p) => Math.abs(p.pass - pass) <= 1)
  const span = (xs: number[]) => (xs.length ? [Math.min(...xs), Math.max(...xs)] : null)
  return {
    n: near.length,
    views: span(near.map((p) => p.views)),
    fyp: span(near.map((p) => p.fyp)),
    still2s: span(near.flatMap((p) => (p.still2s === null ? [] : [p.still2s]))),
  }
}

export const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
