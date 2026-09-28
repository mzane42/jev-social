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

`jev-social discover --niche <slug> [--per-keyword 12] [--hashtags 5]`

1. Each seed → existing profile collector → captions and bio.
   Top `--hashtags` hashtags (generic tags like `#fyp` removed) become extra
   keywords; `@mentions` become candidates.
2. Each keyword (user keywords + harvested hashtags) → `tiktok search`
   (author handle parsed from each video URL) and `instagram search_accounts`.
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

`tiktok search` times out (managed Chrome shows TikTok login page) and
`instagram search_accounts` returns `search_control_not_found`. Both are
captured as failure fixtures. `instagram search --preview` works but its
cards carry no author, so it is not used.
