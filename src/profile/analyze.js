// Ports (see docs/superpowers/specs/2026-09-27-upstream-sync-and-niche-reports-design.md, part B):
//   collector.collect({ platform, handle, url, videos, deep, signal }) → { profile, items, partial, partialReason }
//   insights.write({ snapshot, metrics, signal }) → Insight[] | null (null = disabled)
//   repository.save(record) → { dir }; repository.listLatest() → entries; repository.writeIndex(relPath, html)
//   classifier.classify({ deck, items, signal }) → Map(url → { theme, format, news, model }) ; classifier null = disabled
//   loadDeck(niche) → { niche, themes, formats, version } | null (no deck = no classification)
//   render.report(record) / render.nicheIndex(niche, entries) / render.rootIndex(niches) → html
import { computeMetrics, parseProfileTargets, validateNiche, validateRange } from "./domain.js";

function hasCapturedDetail(items) {
  return items.some((item) =>
    item.caption ||
    item.topComments?.length ||
    item.views != null ||
    item.likes != null ||
    item.comments != null ||
    item.shares != null ||
    item.saves != null);
}

export async function analyzeProfile(deps, { url, niche, videos = 12, deep = 3, signal }) {
  const { collector, insights, repository, render, version, now = () => new Date() } = deps;
  const targets = parseProfileTargets(url);
  validateNiche(niche);
  validateRange("--videos", videos, 1, 50);
  validateRange("--deep", deep, 0, 10);

  let target;
  let collected;
  const skipped = [];
  for (const [index, candidate] of targets.entries()) {
    try {
      collected = await collector.collect({ ...candidate, videos, deep, signal });
      target = candidate;
      break;
    } catch (error) {
      if (error?.code !== "PROFILE_NOT_FOUND") throw error;
      skipped.push(`${candidate.platform}: ${error.message}`);
      if (index === targets.length - 1) {
        if (skipped.length > 1) error.message = skipped.join(" | ");
        throw error;
      }
    }
  }
  const snapshot = { platform: target.platform, handle: target.handle, niche, url: target.url, capturedAt: now().toISOString(), ...collected };
  if (skipped.length) snapshot.fallbackFrom = skipped.join(" | ");
  const metrics = computeMetrics(snapshot);

  let list = [];
  let insightNotice = null;
  if (!hasCapturedDetail(snapshot.items)) {
    insightNotice = "Insights skipped: nothing beyond item URLs was captured.";
  } else {
    try {
      const written = await insights.write({ snapshot, metrics, signal });
      if (written === null) insightNotice = "Insights disabled (OPENROUTER_REPORT_MODEL=off or no API key).";
      else if (!written.length) insightNotice = "No cited insights were produced.";
      else list = written;
    } catch (error) {
      insightNotice = `Insights unavailable: ${error.message}`;
    }
  }

  const record = { snapshot, metrics, insights: list, insightNotice };
  const { dir } = await repository.save({ ...record, html: render.report({ ...record, version }) });
  const classification = await classifyItems(deps, niche, snapshot.items, signal);
  await rebuildIndexes({ repository, render });
  return { dir, snapshot, metrics, insights: list, classification };
}

// Classifies items not yet classified under the niche's current deck. Never fails the caller:
// a Jev outage leaves the report saved and says why.
export async function classifyItems({ classifier, loadDeck, repository }, niche, items, signal) {
  if (!classifier || !loadDeck || !repository.classifications) return { classified: 0, skipped: "classification disabled" };
  const deck = await loadDeck(niche);
  if (!deck) return { classified: 0, skipped: `no deck at niches/${niche}.json` };
  const done = repository.classifications(deck.version, niche);
  const media = repository.media?.(niche) ?? new Map();
  const todo = items.filter((item) => !done.has(item.url)).map((item) => ({ ...item, transcript: media.get(item.url)?.transcript ?? null }));
  if (!todo.length) return { classified: 0, skipped: null };
  try {
    const result = await classifier.classify({ deck, items: todo, signal });
    repository.saveClassifications(deck.version, niche, result);
    return { classified: result.size, skipped: null };
  } catch (error) {
    if (error.partial?.size) repository.saveClassifications(deck.version, niche, error.partial);
    return { classified: error.partial?.size ?? 0, skipped: `Jev classification failed: ${error.message}` };
  }
}

export async function classifyReports(deps, { niche, signal } = {}) {
  let classified = 0;
  const notes = [];
  for (const entry of await deps.repository.listLatest()) {
    if (niche && entry.niche !== niche) continue;
    const result = await classifyItems(deps, entry.niche, entry.data.snapshot.items, signal);
    classified += result.classified;
    if (result.skipped) notes.push(`${entry.niche}/${entry.account}: ${result.skipped}`);
  }
  return { classified, notes };
}

export async function rebuildIndexes({ repository, render }) {
  const byNiche = new Map();
  for (const entry of await repository.listLatest()) {
    if (!byNiche.has(entry.niche)) byNiche.set(entry.niche, []);
    byNiche.get(entry.niche).push(entry);
  }
  const summary = [];
  for (const [niche, entries] of byNiche) {
    await repository.writeIndex(`${niche}/index.html`, render.nicheIndex(niche, entries.map(({ href, data }) => ({ href, snapshot: data.snapshot, metrics: data.metrics }))));
    const updatedAt = entries.map(({ data }) => data.snapshot.capturedAt).sort().at(-1);
    summary.push({ niche, accounts: entries.length, updatedAt });
  }
  await repository.writeIndex("index.html", render.rootIndex(summary));
  return { niches: summary.length, accounts: summary.reduce((total, entry) => total + entry.accounts, 0) };
}

// Top N and bottom M videos by views per latest report of the niche, skipping ones already processed.
export function pickMediaTargets(entries, done, { top = 5, flops = 3 } = {}) {
  return entries.map((entry) => {
    const ranked = entry.data.snapshot.items.filter((item) => item.views != null && item.url).sort((a, b) => b.views - a.views);
    const chosen = [...ranked.slice(0, top), ...ranked.slice(top).slice(-flops)];
    return { entry, items: chosen.filter((item) => !done.get(item.url) || done.get(item.url).error) };
  }).filter((target) => target.items.length);
}

// Download → frames → local transcript → hook reading, per account batch; then re-classify with transcripts.
// One failed video is recorded with its error and never stops the batch.
export async function analyzeMedia(deps, { niche, top = 5, flops = 3, rehook = false, log = () => {}, signal }) {
  const { media, repository } = deps;
  const hookTypes = (await deps.loadDeck?.(niche))?.hooks ?? undefined;
  if (rehook) return rereadHooks(deps, { niche, hookTypes, log, signal });
  const entries = (await repository.listLatest()).filter((entry) => entry.niche === niche && entry.data.snapshot.platform === "tiktok");
  const targets = pickMediaTargets(entries, repository.media(niche), { top, flops });
  let processed = 0;
  for (const { entry, items } of targets) {
    log(`${entry.account}: downloading ${items.length} videos`);
    const paths = await media.download(items.map((item) => item.url), { signal });
    for (const item of items) {
      const videoPath = paths.get(item.url);
      if (!videoPath) {
        repository.saveMedia(niche, { url: item.url, error: "download failed" });
        continue;
      }
      try {
        const frames = await media.frames(videoPath);
        const { text, head } = await media.transcribe(videoPath);
        const hook = await media.readHook({ frames, head, caption: item.caption, hookTypes, signal }).catch((error) => ({ error: error.message }));
        repository.saveMedia(niche, { url: item.url, videoPath, frames, transcript: text, head, ...hook });
        processed += 1;
        log(`  ${item.url.split("/").pop()}: ${hook?.hookType ?? "no hook read"}`);
      } catch (error) {
        repository.saveMedia(niche, { url: item.url, videoPath, error: error.message });
      }
    }
  }
  const classification = await classifyReports(deps, { niche, signal });
  return { processed, classified: classification.classified, notes: classification.notes };
}
// Re-reads hooks from frames already on disk (model or prompt change); keeps video, frames and transcript.
async function rereadHooks({ media, repository }, { niche, hookTypes, log, signal }) {
  const captions = new Map((await repository.listLatest()).filter((e) => e.niche === niche).flatMap((e) => e.data.snapshot.items.map((i) => [i.url, i.caption])));
  let processed = 0;
  for (const row of repository.media(niche).values()) {
    if (!row.frames.length) continue;
    const hook = await media.readHook({ frames: row.frames, head: row.transcript_head || "", caption: captions.get(row.url), hookTypes, signal })
      .catch((error) => ({ error: error.message }));
    // A failed re-read keeps the previous reading instead of overwriting it with an error.
    if (!hook?.error) {
      repository.saveMedia(niche, { url: row.url, videoPath: row.video_path, frames: row.frames, transcript: row.transcript, head: row.transcript_head, ...hook }, { keepClassification: true });
      processed += 1;
    }
    log(`  ${row.url.split("/").pop()}: ${hook?.hookType ?? hook?.error}`);
  }
  return { processed, classified: 0, notes: [] };
}