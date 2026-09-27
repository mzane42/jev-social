# Upstream release sync and niche profile reports — design

Date: 2026-09-27 · Fork: `mzane42/jev-social` · Upstream: `socai-io/jev-social`

Two independent additions to the fork. **B is built first. A is deferred**: its spec is kept here for later, and it is not in the current implementation plan.

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

Prerequisites, set once by the owner:

- In Settings → Actions → General, enable "Allow GitHub Actions to create and approve pull requests". It is currently off, so `gh pr create` would fail.
- Enable workflows once in the fork's Actions tab. Schedules are disabled on forks by default.
- GitHub auto-disables schedules on public repos after 60 days without activity. `workflow_dispatch` is the fallback.

Steps:

1. Resolve the target tag: the `tag` input, else `gh release view -R socai-io/jev-social --json tagName`. Reject any tag that does not match `^v[0-9]+\.[0-9]+\.[0-9]+$` before using it in a shell command.
2. Check out with `actions/checkout` and `fetch-depth: 0`. Fetch the tag with `git fetch --no-tags https://github.com/socai-io/jev-social.git refs/tags/<tag>:refs/tags/<tag>`. Upstream tags are annotated.
3. **Exit without changes** if any of the following holds:
   - `git merge-base --is-ancestor <tag>^{commit} origin/main`;
   - `gh pr list --head sync/upstream-<tag> --state all` is non-empty. This counts closed PRs too, so a deliberately closed sync PR is not re-created, and a squash- or rebase-merged PR does not loop;
   - `gh issue list --state all --search "<tag> in:title"` finds an issue this workflow created.
4. **Verify provenance** with `gh release verify <tag> -R socai-io/jev-social`, retrying once. If it still fails, open an issue titled `Upstream release <tag> failed verification` with the output, and stop.
5. Create branch `sync/upstream-<tag>` from `origin/main` and run `git merge --no-ff --no-edit -m "Sync upstream <tag>" <tag>`.
   - **Clean merge:**
     1. Run `npm ci && npm run check && npm test` on the merged tree. PRs opened with `GITHUB_TOKEN` do not trigger the fork's other workflows, so this is the only CI the PR gets.
     2. Push the branch and open a PR titled `Sync upstream <tag>`, passing the body with `--body-file`. The body contains:
        - the upstream release notes;
        - the verification result;
        - the test result, with the output tail on failure;
        - a warning line if the diff matches `socai v?[0-9]+\.[0-9]+\.[0-9]+`;
        - the instruction "merge with a merge commit (not squash/rebase)".
   - **Conflict:** abort the merge and push nothing. Open an issue titled `Upstream <tag> merge conflicts` that lists the conflicting files (`git diff --name-only --diff-filter=U`) and gives the local commands to reproduce: fetch the tag, then merge.

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

- `<profile-url>`: a `tiktok.com/@handle` or `instagram.com/handle` URL. The platform is inferred from the host. Other hosts are rejected. The handle must match `^[A-Za-z0-9._]{1,64}$` and must not be `.` or `..`, because it becomes a path segment.
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

A second run on the same day overwrites that day's folder. Directories are created with mode `0700` and files with mode `0600`. Files are written atomically (temp file, then rename), mirroring `writeConfig` in `src/config.js`.

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
- `postsPerWeek = (n - 1) / spanWeeks` over the collected items that have a `createdAt`. It is `null` when n < 2.

Any metric whose inputs are missing is `null`. Items without views are excluded from medians.

### Collector (socai)

- Reuses the existing socai binary resolution (`resolveSocaiBin`). The collector receives an injected `runJson(args) → object` dependency. Its default is the socai JSON runner, which is exported from `src/socai.js` for this purpose; tests pass a fake.
- Environment: `childEnvironment` in `src/process.js` already forwards `SOCAI_*` variables and forces `SOCAI_TELEMETRY=0`. The collector also sets `SOCAI_NO_UPDATE_CHECK=1`, and `SOCAI_TELEMETRY_QUERY_TEXT=off`, which is the value the existing tests use.
- **TikTok:** arguments come from `buildActionArgs` in `src/actions.js`. `buildTikTokVideoArgs` is not reused, because it hardcodes `--download-media`.
  1. `tiktok author <url> --num <videos>`;
  2. rank the collected cards by parsed views;
  3. `tiktok get-videos --video <full URL> --num-comments 8` for each of the top `deep` cards. Full URLs are required, because bare IDs time out.
  - If `video_cards` is empty (for example, in the not-logged-in case), skip step 3.
- **Instagram:** a new small builder produces `instagram profile <url> --num <videos> --deep <deep> --num-comments 8`. Instagram exposes no likes or views here, so these fields stay `null`. Comment text carries UI noise (for example `12 sem99 686 J'aimeRépondre`); strip the trailing relative-time, like-count, and reply/translate tokens.
- Never passes `--transcribe-audio` or `--download-media`, and never calls `comment` or any write operation.
- If the page reports a login gate or a challenge, or `ok:false` with `author_videos_incomplete`, the collector returns a snapshot with `partial: true` and the reason, keeping whatever profile data was captured. If no profile data at all is captured, it throws an `AppError` with a clear message: “log in to <platform> in the socai Chrome window, then retry”.

### InsightWriter (OpenRouter)

- Model: `OPENROUTER_REPORT_MODEL`, default `openai/gpt-4o-mini`. The value `off` disables the writer.
- Input: a bounded, sanitised payload containing the metrics, plus per item the URL, caption (≤300 chars), stats, and up to 5 comments (≤200 chars each). No local paths and no raw socai JSON.
- Output: 3–6 insights of the form `{ title, body, sources: [itemUrl…] }`.
- Validation: each source must be an item URL from the snapshot, and each insight needs at least one source. Invalid insights are dropped. If none survive, the report shows a notice instead of insights. `validateResearchReport` in `src/report.js` is Markdown-specific and is not reused. The payload is sanitised with `redactLocalPaths` and the `publicEvidence` pattern from `src/evidence.js`.
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

Fixtures in `test/fixtures/profile/` are trimmed copies of today's TikTok author, get-videos, and Instagram deep-profile JSON. Because the fork is public, the fixtures are anonymised: fake handles, fake commenter names, and no signed CDN URLs.

The CLI extends `parseArgs` in `bin/jev-social.js` with `--niche`, `--videos`, and `--deep`, and adds the two-token command `reports rebuild` to the command chain.

- `domain`: `parseCount` edge cases; metrics with null views and zero followers; the outlier threshold.
- `socai-collector`: argument building; parsing the fixtures into `ProfileSnapshot`; the partial path on `author_videos_incomplete`. Uses a fake process runner.
- `openrouter-insights`: rejects foreign or missing sources; `off` returns `[]`. Uses a fake fetch.
- `fs-repository`: path layout and file modes in a temp dir; `listLatest` picks the newest date per account.
- `html-renderer`: escapes `<script>` in captions and comments, renders `n/a` for nulls, drops non-allowlisted links.
- `analyze`: end-to-end with fake ports.
