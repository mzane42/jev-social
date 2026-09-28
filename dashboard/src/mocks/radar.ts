import type { RadarData } from '@/types'

/**
 * MOCK: Story radar. Invented, neutral summaries used only to lay out the
 * screen. They are not claims about real events or outcomes.
 */
export const radarMock: RadarData = {
  mock: true,
  stories: [
    {
      id: 'city-charges',
      tag: 'HOT',
      category: 'Governance',
      headline: 'Man City vs Premier League: the financial charges case',
      summary: 'Coverage of the independent commission process over the league’s financial-rules charges and the timeline for a ruling.',
      sources: { 'news-rss': 42, 'youtube-drama': 18, x: 310, reddit: 64 },
      arcPitch: 'A title-winning club waits on a verdict behind closed doors while the season keeps moving. Each chapter is a matchday under a cloud.',
      characters: ['Club chairman', 'League counsel', 'Commission panel', 'Manager'],
      scores: { drama: 92, mangaability: 78, nicheGap: 64 },
      coverage: '3 of 14 tracked niche accounts covered it, none in manga style.',
      firstSeen: '2026-09-25',
    },
    {
      id: 'mbappe-wages',
      tag: 'OPEN ANGLE',
      category: 'Contracts',
      headline: 'Mbappé and PSG: the unpaid wages dispute',
      summary: 'Reporting on the player’s claim over withheld salary and bonuses and the club’s position, now before the relevant bodies.',
      sources: { 'news-rss': 27, 'youtube-drama': 9, x: 140, reddit: 38 },
      arcPitch: 'A star who already left fights his old club over a promise. Flashbacks to the signing, present-day hearings.',
      characters: ['Mbappé', 'Club president', 'Player’s lawyer', 'League official'],
      scores: { drama: 81, mangaability: 85, nicheGap: 88 },
      coverage: '1 of 14 tracked niche accounts covered it. Clear gap for a manga arc.',
      firstSeen: '2026-09-22',
    },
    {
      id: 'derby-var',
      tag: 'MATCH',
      category: 'Refereeing',
      headline: 'Derby VAR decision sparks debate',
      summary: 'A late VAR review in a city derby drew criticism from both managers; the referees’ body published its audio explanation.',
      sources: { 'news-rss': 19, 'youtube-drama': 24, x: 520, reddit: 91 },
      arcPitch: 'Ninety minutes of rivalry decided in a screening room. The referee becomes the main character for one episode.',
      characters: ['Referee', 'VAR official', 'Home manager', 'Away captain'],
      scores: { drama: 76, mangaability: 70, nicheGap: 41 },
      coverage: '6 of 14 tracked niche accounts covered it within 24 h.',
      firstSeen: '2026-09-27',
    },
  ],
  characters: [
    { name: 'Mbappé', role: 'Player', appearances: 11, heat: 88 },
    { name: 'Club chairman', role: 'Executive', appearances: 8, heat: 74 },
    { name: 'Referee', role: 'Official', appearances: 7, heat: 69 },
    { name: 'League counsel', role: 'Legal', appearances: 5, heat: 52 },
    { name: 'Home manager', role: 'Coach', appearances: 4, heat: 47 },
  ],
  crossings: [
    { category: 'Governance', dramaVolume: 86, mangaCoverage: 12 },
    { category: 'Contracts', dramaVolume: 64, mangaCoverage: 8 },
    { category: 'Refereeing', dramaVolume: 78, mangaCoverage: 35 },
    { category: 'Transfers', dramaVolume: 70, mangaCoverage: 52 },
    { category: 'Rivalries', dramaVolume: 58, mangaCoverage: 61 },
  ],
}
