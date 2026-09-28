# Jev virality prior art — Story radar + dashboard + script/caption scorer

Research date: 2026-09-28. Scope: read-only survey of existing Jev/TypeSafe-based
virality and social-scoring projects, to inform the "360" niche-virality app in
this repo (Story radar, account/niche dashboard, script/caption scorer for
short anime football-drama videos).

Primary Jev/TypeSafe facts below are corroborated by this repo's own working
code (`src/decision-provider.js`, `src/classifier.js`, `docs/simple-jev.md`),
which already calls `~typesafe/jev-latest` at
`https://openrouter.ai/api/alpha/decisions` and the TypeSafe-compatible
`/v1/systemone` shape — so the API this task describes is the same one this
repo integrates with today, not a new one to evaluate from scratch.

## 1. Project summaries

### 1.1 DDnim/jev-tweet-radar (X/Twitter timeline scorer, Chrome + Safari extension)

MIT license, 1 star, 0 forks, last updated 2026-09-27 (this repo is small and
very recent — treat it as a working reference implementation, not a mature or
widely-adopted project). It is a Manifest V3 browser extension that watches
`article[data-testid="tweet"]` nodes with an `IntersectionObserver`
(pre-fetching ~2000px above/below the viewport), extracts author/time/media/
text, and sends **one Jev call per post** to `https://api.typesafe.ai/v1/systemone`
carrying up to nine Noul questions in a single request. Results are cached in
`chrome.storage.local` keyed by tweet id + asked-question-set + goal hash, so a
given post is judged at most once. It renders two of the answers (buzz, engage)
as coloured bars under the avatar, uses spam/ai_smell to fold low-quality posts,
and drives a long-press action (like+bookmark, then repost/quote/reply window
chosen by threshold) purely from the returned probabilities. Repo:
https://github.com/DDnim/jev-tweet-radar — MIT.

**Exact questions (all `type: "noul"`, all with two-sided `criteria.true`/
`criteria.false` — this sharpens the boundary and is a pattern worth copying;
our §2 sets below use bare Nouls and should adopt two-sided criteria too):**

| key | English gloss of `instructions` | criteria.true | criteria.false |
|---|---|---|---|
| `engage` (always asked) | Worth replying/quoting for an AI/data/dev-interested reader? Concrete claim, room for debate, not spam/promo/bot/empty reaction. | concrete, debatable, worth engaging | empty/spam/promo/bot/just a reaction |
| `buzz` (always asked) | Likely to spread widely (many likes/reposts)? Surprise, strong claim, useful info, emotional pull, shareable hook. | has a viral hook | ordinary, unlikely to spread |
| `flame` | Likely to draw backlash/criticism/quote-dunking? Provocative, absolutist, looks down on a group, factually wrong, ethically grey. | invites backlash | no backlash trigger |
| `ignored` | Likely to get almost no reaction? Thin content, no context, unclear addressee, no hook. | likely to be ignored | likely to get some reaction |
| `misread` | Likely to be taken to mean something other than intended? Sarcasm that won't land, missing subject/premise, heavy ellipsis, ambiguous wording. | easy to misread | intent comes through clearly |
| `repost` (always asked) | Worth reposting to your own followers? Useful, accurate-seeming, novel, broadly relevant, not promo/bait. | worth reposting | not worth reposting |
| `bookmark` | Worth bookmarking to revisit later? Procedure/data/link/idea with lasting reference value, not a one-off reaction/hot take. | worth saving for later | disposable, not worth saving |
| `spam` (always asked) | Is this spam/junk? Promo/affiliate/scam/side-hustle pitch, bot/auto-post, follow-for-follow/like-begging/engagement farming, unauthorized reposting of others' content, unrelated hashtag walls, repeated boilerplate. | spam/junk | substantive, normal post |
| `ai_smell` (always asked) | Reads like AI-generated text? Templated structure, heavy bullet+emoji use, generic phrases like "let's break it down"/"in summary", generic content with no specifics, unnaturally polished prose. | reads as AI-written | reads as human-written |

**Thresholds used in the product, with numbers:**
- Judgment threshold default `0.5`; rarity tint on the avatar column from
  `max(buzz, engage)`: **>0.75 gold, >0.60 purple, >0.45 green, else white**.
- Long-press actions: **repost if repost>0.5**, **quote instead of plain
  repost if repost>0.7**, **open reply window if engage>0.7**; a tie between
  repost/engage favors reply; posts already reposted don't get a quote
  window.
- **Fold + reinterpret long-press as "block author"** when `spam>0.85` or
  `ai_smell>0.85`.
- Default timeline filter rules: `spam ≥ 0.7` fade-to-50%-opacity (on by
  default), `ai_smell ≥ 0.7`, `flame ≥ 0.7`, `ignored ≥ 0.7`, `engage < 0.3`
  (all off by default, user-toggleable).

**Pre-call gating (the honest answer to "how it filters in code before
calling Jev"): it does not filter on post *content* before the call — every
visible post that scrolls into range gets judged.** What it does gate on:
extension enabled + API key present; a per-tweet-id cache hit (cache key =
`tweet id : asked-question-set : goal-hash`, so re-asking the same questions
for the same post never re-calls the API, but a new goal preset does); an
in-flight dedup map (concurrent requests for the same post share one fetch);
and a rate limiter (`maxPerMinute`, default **120/min**). *Content*-based
filtering (`filterReasons`) happens strictly **after** the Jev call, dimming
matched posts. Failures back off with **exponential delay from 800 ms, ×2 per
attempt, up to 4 attempts**, on HTTP 429/529.

**Cost/latency:** ≈300 input tokens per post ≈ **$0.00001**, output tokens
free (matches TypeSafe's advertised free-output pricing); the popup surfaces
the day's call count and running cost from `usage` echoed back per call.

### 1.2 SuperX "Tweet Tester" / "Jev + SuperX = virality solved"

SuperX (https://superx.so) is a commercial X/Twitter growth SaaS (scheduling,
analytics, AI content) with a free public page, https://superx.so/tweet-tester
("Will your post beat your average?"), and an open-source CLI/agent-skill repo,
https://github.com/superx-so/superx-agent (MIT, 27 stars). The viral claim
("61 questions in ~1s for $0.0004, fitted on 9,481 real posts from 207
creators, picks the viral post 2 in 3 times, never rewards reply bait") comes
from a viral X post by Rob Hallam (@robj3d3, the SuperX founder — bio lists
`superx.so $22K/mo`), confirmed verbatim via a read-only mirror:
"Jev + SuperX = virality solved. Every post gets 61 questions in ~1s for
$0.0004. > fitted on 9,481 real posts from 207 creators > picks the viral post
2 in 3 times > never rewards reply bait. So: write, score, rewrite, stop when
it peaks. Free, no signup. try it below ↓" (https://x.com/robj3d3/status/2100722975645598191,
attached media is a screen-recording video, not a text breakdown of the
families/questions — so the 61-question list is not published even in the
original claim). Treat the exact numbers as a self-reported claim by the
product's own founder, not independently verified. The public landing
page and the open `viral-score-iterate` recipe
(https://github.com/superx-so/superx-agent/blob/main/skills/superx/references/skills/viral-score-iterate/recipe.md)
confirm the *mechanism* but not the *question list*: the score is "the chance
the post beats the account's own normal post" (framed as "72 means it beats
your usual post about 72 times in 100"), it is fit per-account against recent
history, it returns `score`, `helped`, `hurt`, `warnings`, it explicitly
**never rewards asking for replies/follows/DMs or hashtag/emoji padding**
(the anti-signal), and iteration stops after 6 rounds or two flat rounds. The
"8 families" (Emotion, Conversation, Share, Timely, Craft, Identity, Format,
Anti) named in this task's brief were **not found published anywhere** at the
question level in SuperX's own docs, blog, or repo — the 61 questions
themselves are proprietary. We reconstruct a family-based question set for our
own use in §2.2, attributed as "inspired by the publicly described SuperX
methodology," not copied from it.

### 1.3 OpenTweet "Will It Go Viral" (free hosted Jev scorer)

https://opentweet.io/jev is a hosted, no-signup Jev-backed post scorer:
7 questions per draft — 4 `Score` rubrics (reach, hook, clarity, specificity)
and 3 `Noul`s (AI-slop, engagement-bait, toxicity) — sent as one Jev request.
OpenTweet also publishes a Jev-based content-moderation pattern
(https://opentweet.io/jev/content-moderation): 7 Nouls (spam, scam,
harassment, sexual, self-harm, doxxing, off-topic) plus one 0–3 `Score`
(harm severity), each rule with **two cut points** — a `review` threshold
(0.40–0.80) and a stricter `hide` threshold (0.85–0.97) — with `self_harm`
and `off_topic` deliberately set to an unreachable `1.01` `hide` value so they
always route to a human queue rather than auto-hiding. Priority in the queue
is `severity × max(matched probabilities)`. OpenTweet appears to be a content
site/product, not an open-source repo — treat its code snippets as
illustrative patterns to reimplement, not a license to copy source.

### 1.4 awesome-jev-by-typesafe / awesome-jev-typesafe (community lists) and TypeSafe's own docs

- **Anil-matcha/awesome-jev-by-typesafe** — MIT, **864 stars**, not a fork,
  reviewed 2026-09-19, updated 2026-09-27. The most substantial and current
  list found; doubles as the best available secondary source for TypeSafe's
  own docs (it mirrors `docs.typesafe.ai` facts in a "Quick facts" table).
  https://github.com/Anil-matcha/awesome-jev-by-typesafe
- **cobanov/awesome-jev** — CC0-1.0, 418 stars, not a fork.
  https://github.com/cobanov/awesome-jev
- **valentynkit/awesome-jev-typesafe** — CC0, 172 stars, source of a
  particularly useful "Know before you build" caveats section (see §4).
  https://github.com/valentynkit/awesome-jev-typesafe
- The brief's slug **DansiDanutz/awesome-jev-typesafe** exists and confirmed
  as a **fork of `valentynkit/awesome-jev-typesafe`** (0 stars own, 172 stars
  on the parent). Use the parent (valentynkit) as the canonical source; the
  fork adds nothing beyond it.
- **TypeSafe's own docs** (`docs.typesafe.ai`, mirrored via the awesome-list
  "Quick facts" table and confirmed against this repo's own
  `docs/simple-jev.md`): three primitives — `Choice` (pick one of ≤255
  labelled options, returns `choice` + per-option `probabilities` +
  `confidence`), `Score` (ordered rubric, returns `score` (probability-
  weighted, can land between levels) + `legend` + `probabilities` +
  `confidence`), `Noul` (single yes/no probability, returns a bare float
  `noul`, no confidence field). Request shape: `{ model, state, questions }`
  where `state` is a free-form string/JSON/array and `questions` is a map of
  `{ type, instructions, criteria }`. Response: `{ model, answers: { <key>:
  {...} }, usage }`. Pricing $0.042 / 1M input tokens, output free. Docs
  disagree slightly on context length ("64k tokens per request" vs "TypeSafe
  documents 32k for state plus the longest question" — both cited on the same
  page), and separately state limits of 250,000 tokens/sec and 1,200
  requests/min, subject to change during early access (the product launched
  this month, September 2026). Model alias `jev-latest` currently resolves to
  `jev-1.13.0`; aliases can move, so pin a version if thresholds matter.

## 2. Proposed Jev question sets

Both sets follow the pattern already used by `src/classifier.js` in this repo:
one Jev call, several questions, `type: "choice"` validated against a fixed
`criteria` object, thresholds and side effects kept in application code, not
in the model.

### 2.A Story radar — score one football-drama news/clip item

Purpose: given one ingested item (RSS headline+body, YouTube video
title+description+top comments, or an X post), decide whether to surface it,
and rank it on drama / manga-ability / niche-gap.

| # | Key | Type | Question (send as `instructions`) | Options / criteria |
|---|---|---|---|---|
| 1 | `is_football` | Noul | Is this item substantively about football (soccer) — players, clubs, competitions, or football-adjacent people (agents, owners, WAGs)? | — |
| 2 | `drama_intensity` | Score | How much interpersonal conflict, betrayal, rivalry, scandal or public falling-out does this item describe? | `["None — routine news", "Mild tension or disagreement", "Open conflict or public callout", "Major scandal/betrayal/rupture"]` |
| 3 | `manga_ability` | Score | How well would this story's *shape* (not its football content) map onto a shonen/shojo manga arc — rival, underdog, betrayal, redemption, tournament stakes? | `["No arc shape", "Weak arc shape", "Clear arc shape", "Ready-made arc (rivalry/betrayal/redemption already present)"]` |
| 4 | `novelty` | Noul | Given `state.similar_items_last_7d` (a list our ingestion supplies — Jev has no memory or web access), does this item add materially new information beyond those? | — |
| 5 | `niche_saturation` | Choice | Given `state.outlets_already_covering` (a count our ingestion supplies), how saturated is this story? | `{"low": "barely covered elsewhere", "medium": "covered by a few outlets", "high": "covered everywhere already, oversaturated"}` |
| 6 | `character_clarity` | Score | How clearly can the item be told through 2–4 named, recognizable people (not abstract club/league news)? | `["No clear characters", "One clear character", "A clear protagonist + antagonist", "A full cast with clear roles"]` |
| 7 | `verifiability` | Choice | How verifiable is the core claim right now? | `{"confirmed": "official confirmation/on-record quote", "reported": "credible outlet reporting, unconfirmed", "rumor": "speculation, anonymous sources, social-media claim only"}` |
| 8 | `emotional_hook` | Choice | What is the primary emotion this item is likely to provoke in a football-drama audience? | `{"anger": "outrage/injustice", "schadenfreude": "rival's misfortune", "hope": "underdog/comeback", "shock": "surprise reveal", "sadness": "loss/tragedy", "none": "flat/no strong emotion"}` |
| 9 | `is_slop` | Noul | Is this item AI-generated filler, a clickbait rehash, or a bot/aggregator repost with no new information? | — |
| 10 | `safety_risk` | Noul | Could covering this item create legal/reputational risk (unverified serious allegations, minors, private medical/legal matters)? | — |
| 11 | `evergreen_vs_timely` | Choice | Is this item time-sensitive (loses value within days) or does it have lasting/evergreen value? | `{"timely": "must post within days", "evergreen": "still relevant in months"}` |
| 12 | `franchise_fit` | Score | Given `state.tracked_storylines` (names+summaries our ingestion supplies — Jev cannot recall what we track), how well does this item fit one of them vs. being a one-off? | `["Unrelated one-off", "Loosely related", "Clearly continues a tracked storyline", "Central to a tracked storyline"]` |
| 13 | `duplicate_of_tracked` | Noul | Given `state.queued_items` (short summaries our ingestion supplies), is this the same underlying event as one already queued? | — |

Note: questions 4, 5, 12 and 13 above depend on cross-item context Jev cannot
supply itself — no web access, no memory across calls (per the vendor's own
"ask it to pick from a deck, never to name a card" caveat, §4). Our own
ingestion code must compute and inject that context into `state` (recency
list, competitor-coverage count, tracked-storyline summaries, queue
summaries); Jev only judges the fit given what we hand it.

Composite score (kept in code, not asked of Jev): something like
`priority = drama_intensity * manga_ability * (1 - niche_saturation_penalty) *
novelty * (1 - is_slop)`, gated by `is_football`, `duplicate_of_tracked` and
`safety_risk` as hard filters — mirroring jev-tweet-radar's pattern of asking
a fixed set every time and doing all thresholding/branching in code
(`filterReasons` in `questions.js`), and OpenTweet's dual-threshold
review/hide pattern for the safety gate.

### 2.B Video script/caption virality — short anime football-drama clips (TikTok/IG)

Adapting the 8-family shape attributed to SuperX (Emotion, Conversation,
Share, Timely, Craft, Identity, Format, Anti) — reconstructed by us, since the
actual 61 questions are not public (see §1.2) — to short-form anime
football-drama content. ~28 questions, mostly Noul (cheap, one float) with a
few Score/Choice for the graded judgments, plus explicit anti-signals.

**Emotion (4)**
1. `strong_emotion` (Noul) — Does the script/caption provoke a strong, specific
   emotion in the first 3 seconds (not just "interesting")?
2. `emotion_named` (Choice) — Primary emotion targeted: `{anger, joy,
   schadenfreude, suspense, sadness, pride, none}`
3. `emotional_payoff` (Noul) — Does the ending deliver on the emotion set up
   at the start (no dropped thread)?
4. `secondhand_embarrassment` (Noul) — Does it rely on cringe/embarrassment
   as the hook (a real but risky driver — flag, don't ban)?

**Conversation (4)**
5. `debate_bait` (Noul) — Does it stake a clear, arguable position people will
   want to agree or disagree with in comments?
6. `open_question` (Noul) — Does the caption end with a genuine question the
   viewer can answer in one line?
7. `predicted_comment_type` (Choice) — What is the single most likely comment
   type: `{agree, disagree, correction, joke, tag_a_friend, none}`
8. `answerable_in_comment` (Noul) — Can a viewer meaningfully respond in a
   comment without watching again (vs. needing to rewatch/research)?

**Share (3)**
9. `identity_signal` (Noul) — Does sharing this say something flattering about
   the sharer's taste/knowledge/fandom (a "this is so me" share)?
10. `group_chat_worthy` (Noul) — Would a fan send this to a specific friend/
    group chat unprompted, not just like it?
11. `useful_to_share` (Noul) — Does it carry information (a real result, stat,
    quote, ranking) worth passing on, not just a reaction?

**Timely (3)**
12. `news_hook_freshness` (Choice, given `state.days_since_source_event` —
    Jev cannot do date arithmetic itself) — How fresh is the real-world hook
    this episode rides on: `{breaking, this_week, evergreen_arc, stale}`
13. `season_calendar_fit` (Noul, given `state.calendar_context` — e.g.
    "today is a matchday for [club]" / "inside the transfer window" —
    computed in code and injected, since Jev has no calendar and cannot
    reason about dates on its own) — Does it land during a live football
    moment that amplifies interest?
14. `expiry_risk` (Noul) — Will this feel dated/irrelevant within 72 hours,
    based on the freshness/calendar context above?

**Craft (5)**
15. `hook_strength` (Score — genuinely ordinal) — How well does the first
    line/frame stop a scroll? `["Weak", "Ok", "Strong", "Exceptional"]`
16. `pacing` (Score — reordered to be a true ordinal scale, not a
    too-slow/too-fast split that would average to "middling") —
    `["Too slow / dead air", "Slightly uneven", "Tight, no dead air"]`
17. `clarity` (Noul) — Can a viewer with zero context follow the plot beat
    without pausing?
18. `specificity` (Noul) — Does it use specific names/numbers/quotes rather
    than vague claims ("a striker," "a big club")?
19. `caption_redundancy` (Noul) — Does the caption repeat what's already
    obvious on screen (wasted real estate) rather than adding context/hook?

**Identity (3)**
20. `character_recognizability` (Noul) — Will a fan of the source
    story/franchise immediately recognize the character(s) depicted?
21. `franchise_consistency` (Noul) — Is characterization consistent with
    established continuity anchors for this series (no contradiction)?
22. `niche_fandom_signal` (Choice) — Primary audience this clip signals
    belonging to: `{football_ultras, anime_fans, general_drama, crossover}`

**Format (3)**
23. `platform_fit` (Choice) — Best-fit format: `{talking_head, montage,
    animatic, meme_template, greenscreen_reaction}`
24. `length_fit` (Choice, not Score — "too long" and "too short" are not two
    ends of one ordinal scale the model should average between; a
    probability-weighted Score would blur both extremes into "about right")
    — `{"too_long": "padded, overstays the hook", "about_right": "matches
    the pacing", "too_short": "truncated, payoff feels cut off"}`
25. `caption_length_fit` (Noul) — Is the caption short enough to read in
    under 2 seconds (no wall of text)?

**Anti-signals (4 — hard/soft gates, mirrors "never rewards reply bait")**
26. `engagement_bait` (Noul) — Does it explicitly ask for
    likes/follows/shares/comments ("comment X if...", "follow for part 2")?
27. `factual_inaccuracy_risk` (Noul) — Does it assert a specific real-world
    football fact (score, transfer, quote) that is unverified or likely
    wrong?
28. `ai_slop_cues` (Noul, **script/caption text only** — Jev is text-only per
    TypeSafe's own docs, so this cannot see uncanny faces/hands or on-screen
    visual glitches; a separate CV-based detector is needed for that) — Does
    the script or caption show generic AI-writing tells (templated
    "let's break it down" phrasing, hashtag walls, formulaic "wait for it" /
    "part 2" hooks, nonsensical or contradictory on-screen text as
    *transcribed in the script*)?
29. `misleading_thumbnail_or_hook` (Noul) — Does the hook promise something
    the payoff doesn't deliver (bait-and-switch)?

Application logic: treat 26–29 as **penalties/gates** applied after scoring
(à la OpenTweet's dual-threshold hide/review and SuperX's "never rewards
reply bait"), not as inputs the model is asked to trade off against the
positive questions — keeps the "don't reward bait" property auditable in code
rather than hoping the weighted sum buries it.

## 3. Calibrating on our own data

Local reports live at `~/.jev-social/reports/<niche>/<platform>@<handle>/<date>/data.json`
(schema: `{snapshot: {platform, handle, niche, profile: {followers, likes,
postCount}, items: [{views, likes, comments, shares, saves, caption,
detailCaptured, ...}]}}`). As of this research date there are **4 report
files**, one effectively empty (`cuisine/tiktok@yummyaccount`, 0 items — likely
a failed/placeholder capture), and three real accounts
(`piscine/tiktok@lepisciniste.fr`, `piscine/tiktok@maopoolbauer`,
`urbex/tiktok@lovurbex`) each with **12 items**, of which only **3 per account
(9 total)** have `detailCaptured: true` (full likes/comments/shares/saves);
the rest have `views` only. That is **36 items total, 9 with full engagement
data, across 3 accounts and 2 niches** — none is football/anime content yet.

Implication for the SuperX-style claim ("picks the viral post 2 in 3 times"):
that number was fit on 9,481 posts across 207 creators — a per-creator
baseline with enough within-creator history to define "your normal post."
With **12 items per account** we do not have enough history to fit a reliable
per-account baseline, and with **3 niches and no football/anime data at all**
we cannot validate the proposed question sets on-domain yet. Concretely:

- **Calibration is not yet realistic with this sample.** A meaningful
  pairwise "does the score rank the actual top post correctly" test needs
  enough same-account posts with real engagement to hold out pairs; 12 items
  (3 with full detail) per account is far below what is useful even for a
  single-account baseline, let alone a cross-account model.
- **What to do next, in order of effort:** (1) capture more history per
  tracked account (aim for 50+ posts/account with `detailCaptured: true`, not
  12) via the profile crawler already in `src/profile/adapters/`; (2) once
  we have real football/anime accounts tracked, compute a simple
  per-account baseline (median views, or a robust z-score against the
  account's own last N posts) exactly as SuperX describes, and treat the Jev
  score as a *ranking* signal to validate against actual view/engagement
  rank within each account — not as an absolute number; (3) only then attempt
  a 2-in-3-style "did it pick the actual top post in each pair" evaluation,
  and expect wide confidence intervals until sample size is in the hundreds.
- Until then, treat both proposed question sets as **untuned priors**: ship
  them, log every Jev answer alongside the eventual view/engagement outcome
  in the reports' existing `data.json` shape (add the Jev answers as a
  sibling field per item, not a new store), and revisit thresholds once
  enough labelled outcomes exist.

## 4. Licensing caveats

- **jev-tweet-radar (MIT)** — safe to copy code directly (question shape,
  cache-key strategy, rate-limit/backoff, filter-rule engine). It is a tiny,
  1-star hobby project though — treat it as a good pattern reference, not as
  battle-tested production code; re-review before shipping.
- **awesome-jev-by-typesafe (MIT), cobanov/awesome-jev (CC0-1.0),
  valentynkit/awesome-jev-typesafe (CC0)** — these are link/summary
  collections, not implementations; safe to quote facts and structure (e.g.
  the "Know before you build" caveats) with attribution, nothing here is
  executable code worth reusing wholesale.
- **superx-agent (MIT)** — the CLI/skill scaffolding and `recipe.md` loop
  pattern (score → rewrite one thing → rescore → stop rule) are copyable
  under MIT. The **61 questions and the fitted 9,481-post model are not
  published** anywhere we found — do not claim to reproduce SuperX's model;
  our §2.2 set is an independent reconstruction "inspired by," not a copy of,
  their family names.
- **OpenTweet** — appears to be a closed commercial product/content site with
  no visible source repo. Its documented question shapes (7-question scorer,
  dual-threshold moderation) are describing a *pattern*, which is not
  copyrightable in the way source code is, but there is no license granting
  reuse of their exact copy/wording. Reimplement the pattern in our own
  words; do not scrape or embed their page text.
- **TypeSafe / Jev itself** — this is a paid, early-access (launched this
  month, September 2026) third-party API we already depend on
  (`~typesafe/jev-latest` via OpenRouter, per this repo's existing code). Key
  vendor-acknowledged caveats worth carrying into our design (from
  valentynkit's "Know before you build," corroborated by the vendor's own
  docs pages linked there): on the vendor's own four-workflow eval Jev scores
  ~68% (mid-tier, not oracle-grade); it cannot do arithmetic/date reasoning or
  emit a value outside the given option list; accuracy degrades as `state`
  fills with irrelevant content, so curating state is our job; aliases like
  `jev-latest` can silently move to a new pinned version, so pin a version
  when thresholds matter and log the `model` field the response echoes back
  (our `src/classifier.js` already does this via `modelVerified`); rate/
  context limits (32k–64k tokens, 1,200 req/min) are explicitly "subject to
  change during early access."

## 5. Sources

- https://github.com/DDnim/jev-tweet-radar (README, `questions.js`,
  `background.js`)
- https://superx.so/tweet-tester
- https://superx.so/blog/superx-playbook
- https://x.com/robj3d3/status/2100722975645598191 (claim only; not
  independently re-verifiable through this tool)
- https://github.com/superx-so/superx-agent
- https://raw.githubusercontent.com/superx-so/superx-agent/main/skills/superx/references/skills/viral-score-iterate/recipe.md
- https://opentweet.io/jev
- https://opentweet.io/jev/content-moderation
- https://github.com/Anil-matcha/awesome-jev-by-typesafe
- https://github.com/cobanov/awesome-jev
- https://github.com/valentynkit/awesome-jev-typesafe
- https://openrouter.ai/docs/guides/community/jev
- https://openrouter.ai/typesafe (OpenRouter's Typesafe/Jev listing)
- https://typesafe.ai (company/product homepage)
- This repo, as primary source for the API already in use:
  `src/decision-provider.js`, `src/classifier.js`, `docs/simple-jev.md`,
  `docs/troubleshooting.md`
- Local calibration data: `~/.jev-social/reports/*/*/*/data.json`
