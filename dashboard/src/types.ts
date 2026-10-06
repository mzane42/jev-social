/* ------------------------------------------------------------------ */
/* Real report shapes (data.json written by `jev-social profile`)      */
/* ------------------------------------------------------------------ */

export type Platform = 'tiktok' | 'instagram' | (string & {})

export interface TopComment {
  text: string
  likes: number | null
}

export interface SnapshotItem {
  url: string
  kind: string | null
  caption: string | null
  createdAt: string | null
  durationSeconds: number | null
  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  saves: number | null
  topComments: TopComment[]
  detailCaptured: boolean
  /** Latest Jev classification (from the local database), null when not classified. */
  jev?: ItemJev | null
  /** Downloaded-video analysis (`jev-social media`), null when not analysed. */
  media?: ItemMedia | null
}

export interface ItemMedia {
  hookType: string | null
  hookNote: string | null
  /** Transcript of the first 3 s (local mlx_whisper). */
  head: string | null
  /** Number of frames served by /api/media/frame (0, 1, 2 s). */
  frames: number
  error: string | null
}

export interface JevAnswer {
  value: string
  confidence: number
}

export type JevKey = 'theme' | 'format' | 'news'
export type ItemJev = Record<JevKey, JevAnswer>

export interface Profile {
  displayName: string | null
  bio: string | null
  followers: number | null
  likes: number | null
  postCount: number | null
}

export interface Snapshot {
  platform: Platform
  handle: string
  niche: string
  url: string | null
  capturedAt: string | null
  partial: boolean
  partialReason: string | null
  profile: Profile
  items: SnapshotItem[]
}

export interface ItemMetrics {
  url: string
  likeRate: number | null
  shareRate: number | null
  saveRate: number | null
  commentRate: number | null
}

export interface Metrics {
  medianViews: number | null
  viewsPerFollower: number | null
  bestItemUrl: string | null
  outliers: string[]
  postsPerWeek: number | null
  items: ItemMetrics[]
}

export interface Insight {
  title: string
  body: string
  sources: string[]
}

export interface ReportData {
  snapshot: Snapshot
  metrics: Metrics
  insights: Insight[]
  insightNotice: string | null
}

/** One entry of GET /api/reports. `account` is the folder name, e.g. `tiktok@handle`. */
export interface ReportEntry {
  niche: string
  account: string
  date: string
  data: ReportData
}

/* ------------------------------------------------------------------ */
/* Future shapes (served from mocks today, backend fills them later)   */
/* ------------------------------------------------------------------ */

export type CohortKind = 'theme' | 'format' | 'timing' | 'news' | 'tier'
export type CohortMetric = 'medianViews' | 'viewsPerFollower' | 'shareRate'
/** How much Jev trusts the bucket, driven mostly by sample size. */
export type Confidence = 'low' | 'medium' | 'high'

export interface CohortBucket {
  label: string
  count: number
  confidence: Confidence
  medianViews: number | null
  viewsPerFollower: number | null
  shareRate: number | null
  /** Mean Jev confidence of the videos in the bucket (Jev cohorts only). */
  jevConfidence?: number | null
}

export interface Cohort {
  kind: CohortKind
  title: string
  subtitle: string
  buckets: CohortBucket[]
  takeaway: string
  mock: boolean
}

export interface KeyPoint {
  title: string
  body: string
  sources: string[]
}

export interface KeyPoints {
  verdict: string
  points: KeyPoint[]
  mock: boolean
}

export interface CopyAvoid {
  copy: string[]
  avoid: string[]
}

export interface HookNote {
  /** Hook type label, e.g. "Cold open on the goal". */
  hook: string
  /** What happens in the first seconds. */
  firstSeconds: string
}

export interface ItemTags {
  theme: string
  format: string
}

/** Account-level fields that the analyzer does not produce yet. */
export interface AccountExtras {
  avgDelayAfterNewsHours: number | null
  keyPoints: KeyPoints
  copyAvoid: CopyAvoid
  cohorts: Cohort[]
  hookNotes: HookNote[]
  /** Deterministic tag guesses assigned by index. */
  tagPool: ItemTags[]
}

export interface NicheCohortRow {
  account: string
  /** Median views per bucket label. */
  values: Record<string, number | null>
}

export interface NicheCohortComparison {
  kind: CohortKind
  title: string
  buckets: string[]
  rows: NicheCohortRow[]
  mock: boolean
}

export type StorySource = 'news-rss' | 'youtube-drama' | 'x' | 'reddit'
export type StoryTag = 'OPEN ANGLE' | 'HOT' | 'MATCH'

export interface Story {
  id: string
  tag: StoryTag
  category: string
  headline: string
  summary: string
  sources: Record<StorySource, number>
  arcPitch: string
  characters: string[]
  scores: { drama: number; mangaability: number; nicheGap: number }
  coverage: string
  firstSeen: string
}

export interface Character {
  name: string
  role: string
  appearances: number
  heat: number
}

export interface CategoryCrossing {
  category: string
  dramaVolume: number
  mangaCoverage: number
}

export interface RadarData {
  stories: Story[]
  characters: Character[]
  crossings: CategoryCrossing[]
  mock: boolean
}
