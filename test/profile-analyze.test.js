import assert from "node:assert/strict";
import test from "node:test";
import { analyzeProfile, rebuildIndexes } from "../src/profile/analyze.js";

function fakes({ insightsResult = [], insightsError = null } = {}) {
  const saved = [];
  const indexes = {};
  const collected = {
    profile: { displayName: "Demo", bio: null, followers: 100, likes: null, postCount: 1 },
    items: [{ url: "https://www.tiktok.com/@demo_creator/video/1", kind: "video", caption: "c", createdAt: null, durationSeconds: null,
      views: 500, likes: 50, comments: null, shares: null, saves: null, topComments: [] }],
    partial: false,
    partialReason: null,
  };
  const deps = {
    version: "0.1.10",
    now: () => new Date("2026-09-27T18:00:00.000Z"),
    collector: { async collect(request) { deps.collectRequest = request; return collected; } },
    insights: { async write() { if (insightsError) throw insightsError; return insightsResult; } },
    repository: {
      async save(record) { saved.push(record); return { dir: "/reports/x" }; },
      async listLatest() { return saved.map((record) => ({ niche: record.snapshot.niche, account: "tiktok@demo_creator", date: "2026-09-27", href: "tiktok@demo_creator/2026-09-27/report.html", data: record })); },
      async writeIndex(relativePath, html) { indexes[relativePath] = html; return relativePath; },
    },
    render: {
      report: ({ insightNotice }) => `report:${insightNotice}`,
      nicheIndex: (niche, entries) => `niche:${niche}:${entries.length}:${entries[0].href}`,
      rootIndex: (niches) => `root:${JSON.stringify(niches)}`,
    },
  };
  return { deps, saved, indexes };
}

test("analyzeProfile validates, collects, scores, renders, saves and rebuilds indexes", async () => {
  const { deps, saved, indexes } = fakes({ insightsResult: [{ title: "t", body: "b", sources: ["https://www.tiktok.com/@demo_creator/video/1"] }] });
  const result = await analyzeProfile(deps, { url: "https://www.tiktok.com/@demo_creator", niche: "football-anime", videos: 5, deep: 2 });
  assert.deepEqual(deps.collectRequest, { platform: "tiktok", handle: "demo_creator", url: "https://www.tiktok.com/@demo_creator", videos: 5, deep: 2, signal: undefined });
  assert.equal(result.dir, "/reports/x");
  assert.equal(result.snapshot.capturedAt, "2026-09-27T18:00:00.000Z");
  assert.equal(result.snapshot.niche, "football-anime");
  assert.equal(result.metrics.medianViews, 500);
  assert.equal(saved[0].html, "report:null");
  assert.equal(saved[0].insights.length, 1);
  assert.equal(indexes["football-anime/index.html"], "niche:football-anime:1:tiktok@demo_creator/2026-09-27/report.html");
  assert.equal(indexes["index.html"], 'root:[{"niche":"football-anime","accounts":1,"updatedAt":"2026-09-27T18:00:00.000Z"}]');
});

test("insight problems never block the report", async () => {
  for (const [options, notice] of [
    [{ insightsResult: null }, "Insights disabled (OPENROUTER_REPORT_MODEL=off or no API key)."],
    [{ insightsResult: [] }, "No cited insights were produced."],
    [{ insightsError: new Error("no credits") }, "Insights unavailable: no credits"],
  ]) {
    const { deps, saved } = fakes(options);
    await analyzeProfile(deps, { url: "https://www.tiktok.com/@demo_creator", niche: "football-anime" });
    assert.equal(saved[0].insightNotice, notice);
    assert.deepEqual(saved[0].insights, []);
  }
});

test("analyzeProfile rejects bad input before collecting", async () => {
  const { deps } = fakes();
  deps.collector.collect = () => assert.fail("must not collect");
  await assert.rejects(analyzeProfile(deps, { url: "https://evil.com/@x", niche: "football-anime" }), { code: "INVALID_PROFILE_INPUT" });
  await assert.rejects(analyzeProfile(deps, { url: "https://www.tiktok.com/@x", niche: "Bad Niche" }), { code: "INVALID_PROFILE_INPUT" });
  await assert.rejects(analyzeProfile(deps, { url: "https://www.tiktok.com/@x", niche: "ok", videos: 51 }), /--videos/);
  await assert.rejects(analyzeProfile(deps, { url: "https://www.tiktok.com/@x", niche: "ok", deep: 11 }), /--deep/);
});

test("rebuildIndexes reports counts", async () => {
  const { deps } = fakes();
  await analyzeProfile(deps, { url: "https://www.tiktok.com/@demo_creator", niche: "football-anime" });
  assert.deepEqual(await rebuildIndexes(deps), { niches: 1, accounts: 1 });
});
