import type { Cohort, CohortBucket, Confidence, ReportData, SnapshotItem } from '@/types'
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
