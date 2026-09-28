// Ports (see docs/superpowers/specs/2026-09-27-upstream-sync-and-niche-reports-design.md, part B):
//   collector.collect({ platform, handle, url, videos, deep, signal }) → { profile, items, partial, partialReason }
//   insights.write({ snapshot, metrics, signal }) → Insight[] | null (null = disabled)
//   repository.save(record) → { dir }; repository.listLatest() → entries; repository.writeIndex(relPath, html)
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
  await rebuildIndexes({ repository, render });
  return { dir, snapshot, metrics, insights: list };
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
