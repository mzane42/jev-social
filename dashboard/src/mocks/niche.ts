import type { NicheCohortComparison } from '@/types'

/**
 * MOCK: cross-account cohort comparison. The account list comes from real
 * report folders; every value is generated deterministically from the name.
 */
const BUCKETS = ['Tournament', 'Transfer', 'Derby', 'Evergreen']

function seeded(str: string): () => number {
  let h = 2166136261
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 13), 1274126177)
    return ((h >>> 0) % 1000) / 1000
  }
}

export function nicheCohortMock(accounts: string[]): NicheCohortComparison {
  return {
    kind: 'theme',
    title: 'Theme / event, median views by account',
    buckets: BUCKETS,
    mock: true,
    rows: accounts.map((account) => {
      const rnd = seeded(account)
      return {
        account,
        values: Object.fromEntries(BUCKETS.map((b, i) => [b, Math.round((40 + rnd() * 400) * 1000 / (i + 1))])),
      }
    }),
  }
}
