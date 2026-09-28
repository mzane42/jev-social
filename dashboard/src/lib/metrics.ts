import type { Cohort, CohortBucket, CohortKind, Confidence, JevKey, NicheCohortComparison, ReportData, ReportEntry, SnapshotItem } from '@/types'
import { isNum } from './format'

export const HIT_X = 3
export const FLOP_X = 0.2

export type Tier = 'hit' | 'above' | 'below' | 'flop' | 'unknown'

export interface ItemRow extends SnapshotItem {
  index: number
  likeRate: number | null
  shareRate: number | null
  saveRate: number | null
  commentRate: number | null
  xMedian: number | null
  tier: Tier
}

export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter(isNum).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

export function medianViewsOf(d: ReportData): number | null {
  return d.metrics.medianViews ?? median(d.snapshot.items.map((i) => i.views))
}

function tierOf(x: number | null): Tier {
  if (!isNum(x)) return 'unknown'
  if (x > HIT_X) return 'hit'
  if (x < FLOP_X) return 'flop'
  return x >= 1 ? 'above' : 'below'
}

/** Joins snapshot items with per-item metrics by URL (never by index). */
export function itemRows(d: ReportData): ItemRow[] {
  const byUrl = new Map(d.metrics.items.map((m) => [m.url, m]))
  const med = medianViewsOf(d)
  return d.snapshot.items.map((item, index) => {
    const m = byUrl.get(item.url)
    const xMedian = isNum(item.views) && isNum(med) && med > 0 ? item.views / med : null
    return {
      ...item,
      index,
      likeRate: m?.likeRate ?? null,
      shareRate: m?.shareRate ?? null,
      saveRate: m?.saveRate ?? null,
      commentRate: m?.commentRate ?? null,
      xMedian,
      tier: tierOf(xMedian),
    }
  })
}

export interface AccountSummary {
  followers: number | null
  medianViews: number | null
  viewsPerFollower: number | null
  /** hits / items with views */
  hitRate: number | null
  /** median of per-item share rates */
  shareRate: number | null
  postsPerWeek: number | null
  itemsWithViews: number
}

export function summarize(d: ReportData, rows = itemRows(d)): AccountSummary {
  const withViews = rows.filter((r) => isNum(r.views))
  const followers = d.snapshot.profile.followers
  const medianViews = medianViewsOf(d)
  return {
    followers,
    medianViews,
    viewsPerFollower:
      d.metrics.viewsPerFollower ?? (isNum(medianViews) && isNum(followers) && followers > 0 ? medianViews / followers : null),
    hitRate: withViews.length && isNum(medianViews) ? withViews.filter((r) => r.tier === 'hit').length / withViews.length : null,
    shareRate: median(rows.map((r) => r.shareRate)),
    postsPerWeek: d.metrics.postsPerWeek,
    itemsWithViews: withViews.length,
  }
}

function confidence(n: number): Confidence {
  return n >= 8 ? 'high' : n >= 4 ? 'medium' : 'low'
}

/** Performance tiers from REAL item views. */
export function tierCohort(d: ReportData, rows = itemRows(d)): Cohort {
  const followers = d.snapshot.profile.followers
  const defs: { tier: Tier; label: string }[] = [
    { tier: 'hit', label: `Hit >${HIT_X}×` },
    { tier: 'above', label: '1–3× median' },
    { tier: 'below', label: '0.2–1× median' },
    { tier: 'flop', label: `Flop <${FLOP_X}×` },
  ]
  const buckets: CohortBucket[] = defs.map(({ tier, label }) => {
    const r = rows.filter((x) => x.tier === tier)
    const mv = median(r.map((x) => x.views))
    return {
      label,
      count: r.length,
      confidence: confidence(r.length),
      medianViews: mv,
      viewsPerFollower: isNum(mv) && isNum(followers) && followers > 0 ? mv / followers : null,
      shareRate: median(r.map((x) => x.shareRate)),
    }
  })
  const known = rows.filter((r) => r.tier !== 'unknown').length
  const hits = buckets[0].count
  return {
    kind: 'tier',
    title: 'Performance tiers',
    subtitle: 'Views vs account median',
    mock: false,
    buckets,
    takeaway: known
      ? `${hits} of ${known} videos with views are hits; ${buckets[3].count} are flops.`
      : 'No view counts captured, tiers unavailable.',
  }
}

/** "premier_league" → "Premier league" (deck keys are snake_case). */
export function jevLabel(key: string): string {
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const JEV_COHORTS: { key: JevKey; kind: CohortKind; title: string; subtitle: string }[] = [
  { key: 'theme', kind: 'theme', title: 'Theme / event', subtitle: 'What the video is about · Jev on caption + comments' },
  { key: 'format', kind: 'format', title: 'Format', subtitle: 'How the video is built · Jev on caption, not on frames' },
  { key: 'news', kind: 'news', title: 'News hook', subtitle: 'Rides a dated event or not · delay in hours needs Story radar' },
]

/** Buckets classified items by one Jev answer, sorted by median views. Null when nothing is classified. */
export function jevCohort(d: ReportData, rows: ItemRow[], key: JevKey): Cohort | null {
  const def = JEV_COHORTS.find((c) => c.key === key)!
  const classified = rows.filter((r) => r.jev)
  if (!classified.length) return null
  const followers = d.snapshot.profile.followers
  const groups = new Map<string, ItemRow[]>()
  for (const r of classified) groups.set(r.jev![key].value, [...(groups.get(r.jev![key].value) ?? []), r])
  const buckets: CohortBucket[] = [...groups.entries()]
    .map(([value, r]) => {
      const mv = median(r.map((x) => x.views))
      return {
        label: jevLabel(value),
        count: r.length,
        confidence: confidence(r.length),
        medianViews: mv,
        viewsPerFollower: isNum(mv) && isNum(followers) && followers > 0 ? mv / followers : null,
        shareRate: median(r.map((x) => x.shareRate)),
        jevConfidence: r.reduce((sum, x) => sum + x.jev![key].confidence, 0) / r.length,
      }
    })
    .sort((a, b) => (b.medianViews ?? -1) - (a.medianViews ?? -1))
  const top = buckets[0]
  const overall = medianViewsOf(d)
  const lift = isNum(top.medianViews) && isNum(overall) && overall > 0 ? top.medianViews / overall : null
  return {
    kind: def.kind,
    title: def.title,
    subtitle: def.subtitle,
    mock: false,
    buckets,
    takeaway: isNum(lift)
      ? `${top.label} leads: ${top.count} video${top.count > 1 ? 's' : ''} at ${lift.toFixed(1)}× the account median.${top.count < 3 ? ' Too few videos to trust.' : ''}`
      : `${classified.length} of ${rows.length} videos classified; no view counts to compare.`,
  }
}

/**
 * Copy = buckets with 2+ videos at 1.5× the account median or more; avoid = 2+ videos under 0.5×.
 * ponytail: fixed thresholds on tiny samples; revisit once accounts carry 50+ classified videos.
 */
export function copyAvoidFrom(cohorts: Cohort[], overall: number | null): { copy: string[]; avoid: string[] } {
  const copy: string[] = []
  const avoid: string[] = []
  if (!isNum(overall) || overall <= 0) return { copy, avoid }
  for (const c of cohorts) {
    for (const b of c.buckets) {
      if (b.count < 2 || !isNum(b.medianViews) || b.label === 'Other') continue
      const x = b.medianViews / overall
      const line = `${c.title}: ${b.label} (${b.count} videos, ${x.toFixed(1)}× median)`
      if (x >= 1.5) copy.push(line)
      else if (x < 0.5) avoid.push(line)
    }
  }
  return { copy, avoid }
}

/**
 * Per-account lift of each Jev bucket: bucket median views ÷ account median views.
 * Ratios, not raw views, so a 1M-follower account does not flatten the others. Null when nothing is classified.
 */
export function nicheJevComparison(entries: ReportEntry[], key: JevKey): NicheCohortComparison | null {
  const def = JEV_COHORTS.find((c) => c.key === key)!
  const perAccount = entries.map((e) => ({ account: e.account, cohort: jevCohort(e.data, itemRows(e.data), key), med: medianViewsOf(e.data) }))
  const counts = new Map<string, number>()
  for (const { cohort } of perAccount) for (const b of cohort?.buckets ?? []) counts.set(b.label, (counts.get(b.label) ?? 0) + b.count)
  if (!counts.size) return null
  const buckets = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label]) => label)
  return {
    kind: def.kind,
    title: `${def.title}, median views ÷ account median`,
    buckets,
    mock: false,
    rows: perAccount
      .filter((a) => a.cohort)
      .map(({ account, cohort, med }) => ({
        account,
        values: Object.fromEntries(
          cohort!.buckets.map((b) => [b.label, isNum(b.medianViews) && isNum(med) && med > 0 ? b.medianViews / med : null]),
        ),
      })),
  }
}
