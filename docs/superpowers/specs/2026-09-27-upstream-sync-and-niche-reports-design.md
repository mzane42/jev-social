# Upstream release sync and niche profile reports — design

Date: 2026-09-27 · Fork: `mzane42/jev-social` · Upstream: `socai-io/jev-social`

Two independent additions to the fork. Build them in order: A first, then B.

## A. Upstream release sync (GitHub Actions)

### Goal

Detect new tagged releases of `socai-io/jev-social` and propose them as a pull request on the fork. Nothing reaches `main` without the owner merging the PR.

### Decisions

- Track **tagged releases only**, not every upstream commit.
- Integrate with a **merge in a PR**. No rebase and no force-push of `main`.
- Approval = the owner merges the PR.

### Workflow

File: `.github/workflows/upstream-release-sync.yml`

Triggers: `schedule` daily at 07:00 UTC, and `workflow_dispatch` with an optional `tag` input (for testing against an older tag).

Permissions: `contents: write`, `pull-requests: write`, `issues: write`. Uses the built-in `GITHUB_TOKEN` only, with no extra secrets.

Steps:

1. Resolve the target tag: the `tag` input, else `gh release view -R socai-io/jev-social --json tagName`.
2. **Exit without changes** if either condition holds:
   - the tag's commit is already an ancestor of `main` (`git merge-base --is-ancestor`);
   - an open PR from branch `sync/upstream-<tag>` exists.
3. **Verify provenance** with `gh release verify <tag> -R socai-io/jev-social`. On failure, open an issue titled `Upstream release <tag> failed verification`, include the command output, and stop.
4. Create branch `sync/upstream-<tag>` from `main`, fetch the upstream tag, and run `git merge --no-ff <tag>`.
   - **Clean merge:** push the branch and open a PR titled `Sync upstream <tag>`. The PR body contains:
     - the upstream release notes;
     - the verification result;
     - a warning line if the diff touches the pinned socai version (grep the diff for `socai` version strings in `README.md`, `skills/`, `src/onboard.js`).
   - **Conflict:** abort the merge, push the branch at `main`, and open an issue titled `Upstream <tag> merge conflicts` that lists the conflicting files (`git diff --name-only --diff-filter=U`).
5. Idempotency: steps 2 and 4 ensure that a rerun on the same tag never produces a second PR or issue. Before creating an issue, check for an open issue with the same title.

The job configures a git identity as `github-actions[bot]` for the merge commit.

### Testing

- Manual `workflow_dispatch` with the default target (`v0.1.10`, already in `main`): expected no-op.
- Manual `workflow_dispatch` with `tag` set to an older release on a scratch branch: expected PR creation path. Close the PR afterwards.
- `actionlint`, if available locally, on the workflow file.

## B. Niche profile reports (local HTML)

### Goal

A single command collects a TikTok or Instagram profile through socai and computes engagement metrics. It asks an OpenRouter model for cited insights and writes a self-contained HTML report into a local folder tree organised by niche. Storage sits behind a port so that a database or a deployed target can be added later without touching the domain.

Out of scope for now: React, a server-side UI, conversational follow-up, media download and video analysis, and any database adapter.

### Commands

```bash
jev-social profile <profile-url> --niche <slug> [--videos 12] [--deep 3]
jev-social reports rebuild
```

- `<profile-url>`: a `tiktok.com/@handle` or `instagram.com/handle` URL. The platform is inferred from the host. Other hosts are rejected.
- `--niche`: lowercase slug `[a-z0-9-]{1,48}`. Required.
- `--videos`: number of cards to collect. Range 1–50, default 12.
- `--deep`: number of top-viewed items to read in detail with comments. Range 0–10, default 3.
- `reports rebuild`: regenerates every `index.html` from the stored `data.json` files.

### Layout

Root: `${JEV_SOCIAL_REPORTS_DIR:-~/.jev-social/reports}`. The root sits outside the repository because the fork is public.

```
<root>/
  index.html                         all niches, with account count and last update
  <niche>/
    index.html                       latest snapshot of each account, side by side
    <platform>@<handle>/
      <YYYY-MM-DD>/
        report.html
        data.json
```

A second run on the same day overwrites that day's folder. Directories are created with mode `0700` and files with mode `0600`, matching the existing `~/.jev-social` convention.

### Architecture

```
src/profile/
  domain.js                  ProfileSnapshot shape, parseCount(), computeMetrics(): pure functions
  analyze.js                 analyzeProfile(): use case, depends only on ports
  adapters/
    socai-collector.js       Collector port
    openrouter-insights.js   InsightWriter port
    fs-repository.js         ReportRepository port
    html-renderer.js         renderReport(), renderNicheIndex(), renderRootIndex(): pure functions
```

Ports, as documented in a comment block at the top of `analyze.js`:

- **Collector**: `collect({ platform, handle, url, videos, deep, signal }) → ProfileSnapshot`
- **InsightWriter**: `write({ snapshot, metrics, signal }) → Insight[]`. It returns `[]` when disabled.
- **ReportRepository**: `save({ snapshot, metrics, insights, html }) → { dir }`, `listLatest(niche?) → StoredReport[]`, `writeIndex(path, html)`

`analyzeProfile({ collector, insights, repository, renderer }, input)` wires these together. The CLI in `bin/jev-social.js` builds the default adapters.

### Domain

`ProfileSnapshot`:

```js
{
  platform: "tiktok" | "instagram",
  handle, niche, url, capturedAt,            // ISO timestamp
  partial: boolean, partialReason: string | null,
  profile: { displayName, bio, followers, likes, postCount },   // numbers or null
  items: [{
    url, kind, caption, createdAt, durationSeconds,
    views, likes, comments, shares, saves,   // numbers or null; never guessed
    topComments: [{ text, likes }]
  }]
}
```

`parseCount("2.2M") → 2200000`, `"320.8K" → 320800`, `"1215" → 1215`, `null` or unparseable input → `null`.

`computeMetrics(snapshot)`:

- `medianViews`, and `viewsPerFollower = medianViews / followers`;
- per item: `likeRate`, `shareRate`, `saveRate`, `commentRate`, each divided by views;
- `outliers`: items whose views exceed 3 × `medianViews`;
- `postsPerWeek`, computed over the collected items that have a `createdAt`.

Any metric whose inputs are missing is `null`. Items without views are excluded from medians.

### Collector (socai)

- Reuses the existing socai binary resolution (`resolveSocaiBin`) and process runner.
- Spawns socai with `SOCAI_TELEMETRY=0`, `SOCAI_TELEMETRY_QUERY_TEXT=0`, and `SOCAI_NO_UPDATE_CHECK=1`.
- **TikTok:**
  1. `socai tiktok author <url> --num <videos>`;
  2. rank the collected cards by parsed views;
  3. `socai tiktok get-videos --video <full URL>` for each of the top `deep` cards, with `--num-comments 8`. Full URLs are required, because bare IDs time out.
- **Instagram:** `socai instagram profile <url> --num <videos> --deep <deep> --num-comments 8`. Instagram exposes no likes or views here, so these fields stay `null`.
- Never passes `--transcribe-audio` or `--download-media`, and never calls `comment` or any write operation.
- If the page reports a login gate or a challenge, or `ok:false` with `author_videos_incomplete`, the collector returns a snapshot with `partial: true` and the reason, keeping whatever profile data was captured. If no profile data at all is captured, it throws an `AppError` with a clear message: “log in to <platform> in the socai Chrome window, then retry”.

### InsightWriter (OpenRouter)

- Model: `OPENROUTER_REPORT_MODEL`, default `openai/gpt-4o-mini`. The value `off` disables the writer.
- Input: a bounded, sanitised payload containing the metrics, plus per item the URL, caption (≤300 chars), stats, and up to 5 comments (≤200 chars each). No local paths and no raw socai JSON.
- Output: 3–6 insights of the form `{ title, body, sources: [itemUrl…] }`.
- Validation: each source must be an item URL from the snapshot, and each insight needs at least one source. Invalid insights are dropped. If none survive, the report shows a notice instead of insights. Follows the validation approach of `validateResearchReport` in `src/report.js`.
- Timeout 30 s. On failure, the report is still written without insights, with a notice.

### Renderer (HTML)

- One self-contained file: inline CSS, no external scripts, no remote fonts. Colour tokens sit on `:root` with a dark-mode override. It works at phone width without horizontal scrolling.
- Sections:
  - headline cards: followers, median views, views per follower, best item;
  - an inline SVG bar chart of views per item;
  - a sortable items table (a small inline script sorts by column);
  - top comments;
  - insights with source links;
  - a “partial” banner when applicable;
  - a footer with the capture time and the tool version.
- **All social text is HTML-escaped** before insertion, because captions, comments, and bios are untrusted. Links are only emitted for `https://` URLs on the tiktok.com and instagram.com hosts.
- `null` values render as “n/a”, never `0`.
- The niche index is a table of the latest snapshot per account (followers, median views, views per follower, outlier count, last capture), linking to each report. The root index lists niches.

### Errors

- Invalid URL, niche, or ranges: an `AppError` before any browser action.
- socai missing: reuse the existing “socai executable not found” error.
- Repository write failures propagate. A failed render or insight step never deletes a previously saved report.

### Testing (offline, `node --test`)

Fixtures in `test/fixtures/profile/` are trimmed and anonymised copies of today's TikTok author, get-videos, and Instagram deep-profile JSON.

- `domain`: `parseCount` edge cases; metrics with null views and zero followers; the outlier threshold.
- `socai-collector`: argument building; parsing the fixtures into `ProfileSnapshot`; the partial path on `author_videos_incomplete`. Uses a fake process runner.
- `openrouter-insights`: rejects foreign or missing sources; `off` returns `[]`. Uses a fake fetch.
- `fs-repository`: path layout and file modes in a temp dir; `listLatest` picks the newest date per account.
- `html-renderer`: escapes `<script>` in captions and comments, renders `n/a` for nulls, drops non-allowlisted links.
- `analyze`: end-to-end with fake ports.
