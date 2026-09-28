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
  const todo = items.filter((item) => !done.has(item.url));
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
