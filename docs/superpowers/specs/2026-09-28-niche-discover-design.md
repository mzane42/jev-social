# Niche account discovery — design

Goal: from a niche's keywords and reference accounts, find other Instagram and
TikTok accounts in the same niche.

socai has no "suggested / similar accounts" command, so discovery is a
one-hop snowball over read-only operations the CLI already exposes.

## Input

`niches/<slug>.json` gains two optional keys next to `themes` / `formats`:

```json
{ "keywords": ["anime football"], "seeds": ["https://www.tiktok.com/@footballcinematicstudio"] }
```

Seeds are full profile URLs (platform must be explicit).

## Flow

`jev-social discover --niche <slug> [--per-keyword 8] [--hashtags 5]`

1. Each seed → existing profile collector → captions and bio.
   Top `--hashtags` hashtags (generic tags like `#fyp` removed) become extra
   keywords; `@mentions` become candidates.
2. Each keyword (user keywords + harvested hashtags) → `tiktok search`
   (author handle parsed from each video URL), `instagram search_accounts`,
   and `instagram search` without `--preview` (opens each post, reads `author`).
3. Candidate key = `platform@handle`. Signals = distinct sources
   (`keyword:x`, `hashtag:y`, `mention:<seed>`). Score = signal count.
   Seeds are excluded.

Output: ranked table on stdout, rows upserted into a SQLite `candidates`
table (`niche, account, score, signals, first_seen, last_seen`).

## Errors

A failed search or seed read (timeout, login gate, missing control) is a
note on stderr; the run continues and saves what it found. Nothing is mocked.

## Boundaries

Read-only. Search queries are only user keywords or hashtags captured from
seed captions, never model output. Handles pass the `HANDLE` regex.

## Out of scope (v1)

Commenters as candidates, second hop, dashboard page, Jev relevance judge.

## Known live state (2026-09-28)

`tiktok search` times out although results render: TikTok moved its search box
to the sidebar and socai 0.6.1's `visible_query` check stays empty. Workaround:
`src/tiktok-snapshot-search.js` re-reads the result links from the
`--debug-snapshot` DOM, then deletes the snapshots. Delete it once socai is fixed.

`instagram search_accounts` returns `search_control_not_found`. Both are
captured as failure fixtures. `instagram search --preview` cards carry no
author; full `instagram search` does (live: 5 accounts for one keyword in 2 min).
Hashtags ending in fyp/foryou/viral/trending are dropped as reach bait.
