import type { AccountExtras, Cohort } from '@/types'

/**
 * MOCK: account-level analysis the backend does not compute yet.
 * Every value here is invented; it only demonstrates the future shape.
 */

const themeCohort: Cohort = {
  kind: 'theme',
  title: 'Theme / event',
  subtitle: 'What the video is about',
  mock: true,
  takeaway: 'Tournament moments beat evergreen club content by roughly 3×.',
  buckets: [
    { label: 'Tournament moment', count: 4, confidence: 'medium', medianViews: 410000, viewsPerFollower: 4.1, shareRate: 0.034 },
    { label: 'Transfer news', count: 3, confidence: 'low', medianViews: 160000, viewsPerFollower: 1.6, shareRate: 0.021 },
    { label: 'Rivalry / derby', count: 3, confidence: 'low', medianViews: 120000, viewsPerFollower: 1.2, shareRate: 0.018 },
    { label: 'Evergreen club', count: 2, confidence: 'low', medianViews: 90000, viewsPerFollower: 0.9, shareRate: 0.011 },
  ],
}

const formatCohort: Cohort = {
  kind: 'format',
  title: 'Format',
  subtitle: 'How the video is built',
  mock: true,
  takeaway: 'Short single-scene clips outperform long multi-episode cuts.',
  buckets: [
    { label: 'Single scene <40s', count: 5, confidence: 'medium', medianViews: 300000, viewsPerFollower: 3.0, shareRate: 0.029 },
    { label: 'Montage 40–90s', count: 4, confidence: 'medium', medianViews: 140000, viewsPerFollower: 1.4, shareRate: 0.02 },
    { label: 'Mini-episode >90s', count: 3, confidence: 'low', medianViews: 70000, viewsPerFollower: 0.7, shareRate: 0.012 },
  ],
}

const timingCohort: Cohort = {
  kind: 'timing',
  title: 'Timing',
  subtitle: 'Delay after the news broke',
  mock: true,
  takeaway: 'Posting within 24 h of the news roughly doubles median views.',
  buckets: [
    { label: '< 6 h', count: 2, confidence: 'low', medianViews: 380000, viewsPerFollower: 3.8, shareRate: 0.036 },
    { label: '6–24 h', count: 4, confidence: 'medium', medianViews: 250000, viewsPerFollower: 2.5, shareRate: 0.027 },
    { label: '1–3 days', count: 3, confidence: 'low', medianViews: 110000, viewsPerFollower: 1.1, shareRate: 0.016 },
    { label: '> 3 days', count: 3, confidence: 'low', medianViews: 60000, viewsPerFollower: 0.6, shareRate: 0.009 },
  ],
}

export const accountExtrasMock: AccountExtras = {
  avgDelayAfterNewsHours: 19,
  keyPoints: {
    mock: true,
    verdict: 'Event-driven clips carry this account; evergreen uploads rarely break past the median.',
    points: [
      { title: 'Ride the big fixture', body: 'Videos tied to a live tournament moment account for most of the top views.', sources: [] },
      { title: 'Open on the payoff', body: 'Hits show the key action in the first two seconds instead of building up to it.', sources: [] },
      { title: 'Keep it under 40 seconds', body: 'Shorter cuts hold a better share rate than long mini-episodes.', sources: [] },
      { title: 'Post fast', body: 'Clips posted the same day as the news outperform late reactions.', sources: [] },
    ],
  },
  copyAvoid: {
    copy: ['Same-day reaction to a headline fixture', 'Hero shot of one recognisable player', 'Caption that names the event'],
    avoid: ['Long recaps of old matches', 'Generic "part 2" uploads', 'Openers without motion'],
  },
  cohorts: [themeCohort, formatCohort, timingCohort],
  hookNotes: [
    { hook: 'Cold open on the key action', firstSeconds: 'Close-up of the ball striking the net, then a hard cut to the celebration.' },
    { hook: 'Face-off stare', firstSeconds: 'Two rivals lock eyes in slow motion before the whistle.' },
    { hook: 'Question on screen', firstSeconds: 'Text card asks who wins, then the first tackle lands.' },
    { hook: 'Slow scenic intro', firstSeconds: 'Wide stadium pan with ambient music, no player on screen.' },
    { hook: 'Recap title card', firstSeconds: 'Static title with the episode number held for three seconds.' },
  ],
  tagPool: [
    { theme: 'Tournament', format: 'Single scene' },
    { theme: 'Transfer', format: 'Montage' },
    { theme: 'Derby', format: 'Single scene' },
    { theme: 'Evergreen', format: 'Mini-episode' },
    { theme: 'Tournament', format: 'Montage' },
    { theme: 'Derby', format: 'Mini-episode' },
  ],
}
