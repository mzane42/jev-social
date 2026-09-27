import assert from "node:assert/strict";
import test from "node:test";
import { escapeHtml, renderNicheIndex, renderReport, renderRootIndex, safeHref } from "../src/profile/adapters/html-renderer.js";

const snapshot = {
  platform: "tiktok", handle: "demo_creator", niche: "football-anime", url: "https://www.tiktok.com/@demo_creator",
  capturedAt: "2026-09-27T18:00:00.000Z", partial: true, partialReason: "author_videos_incomplete",
  profile: { displayName: "<b>Demo</b>", bio: null, followers: 53400, likes: null, postCount: 82 },
  items: [
    { url: "https://www.tiktok.com/@demo_creator/video/1", kind: "video", caption: "<script>alert(1)</script>", createdAt: null,
      durationSeconds: 33, views: 2_200_000, likes: 134_600, comments: null, shares: 42_900, saves: null,
      topComments: [{ text: "<img src=x onerror=alert(1)>", likes: 601 }] },
    { url: "javascript:alert(1)", kind: "video", caption: "evil link", createdAt: null, durationSeconds: null,
      views: null, likes: null, comments: null, shares: null, saves: null, topComments: [] },
  ],
};
const metrics = {
  medianViews: 2_200_000, viewsPerFollower: 41.2, bestItemUrl: snapshot.items[0].url, outliers: [], postsPerWeek: null,
  items: [
    { url: snapshot.items[0].url, likeRate: 0.0612, shareRate: 0.0195, saveRate: null, commentRate: null },
    { url: snapshot.items[1].url, likeRate: null, shareRate: null, saveRate: null, commentRate: null },
  ],
};

test("escapeHtml and safeHref neutralise untrusted text and links", () => {
  assert.equal(escapeHtml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
  assert.equal(safeHref("https://www.tiktok.com/@a/video/1"), "https://www.tiktok.com/@a/video/1");
  assert.equal(safeHref("https://instagram.com/a/"), "https://instagram.com/a/");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("https://tiktok.com.evil.com/x"), null);
  assert.equal(safeHref("http://www.tiktok.com/x"), null);
});

test("renderReport escapes social text, drops unsafe links and shows n/a", () => {
  const html = renderReport({
    snapshot, metrics, version: "0.1.10", insightNotice: null,
    insights: [{ title: "Hook <x>", body: "Body", sources: [snapshot.items[0].url] }],
  });
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /&lt;b&gt;Demo&lt;\/b&gt;/);
  assert.match(html, /Hook &lt;x&gt;/);
  assert.match(html, /n\/a/);
  assert.match(html, /2\.2M/);
  assert.match(html, /6\.1%/);
  assert.match(html, /Partial capture: author_videos_incomplete/);
  assert.match(html, /<svg[^>]*role="img"/);
  assert.match(html, /prefers-color-scheme: dark/);
  assert.doesNotMatch(html, /<script src=|<link[^>]+href="http/);
});

test("renderReport shows the insight notice when there are no insights", () => {
  const html = renderReport({ snapshot: { ...snapshot, partial: false }, metrics, insights: [], insightNotice: "Insights disabled.", version: "0.1.10" });
  assert.match(html, /Insights disabled\./);
  assert.doesNotMatch(html, /Partial capture/);
});

test("index pages link relative reports and escape names", () => {
  const niche = renderNicheIndex("football-anime", [{ href: "tiktok@demo_creator/2026-09-27/report.html", snapshot, metrics }]);
  assert.match(niche, /href="tiktok@demo_creator\/2026-09-27\/report.html"/);
  assert.match(niche, /53\.4K/);
  const root = renderRootIndex([{ niche: "football-anime", accounts: 2, updatedAt: "2026-09-27T18:00:00.000Z" }]);
  assert.match(root, /href="football-anime\/index.html"/);
  assert.match(root, />2</);
});

test("chart bar labels match items-table row numbers (fix #1)", () => {
  const testSnapshot = {
    ...snapshot,
    items: [
      { ...snapshot.items[0], views: 100 },
      { ...snapshot.items[1], views: null },
      { ...snapshot.items[0], views: 300 },
    ],
  };
  const html = renderReport({
    snapshot: testSnapshot,
    metrics: { ...metrics, items: [] },
    version: "0.1.10",
  });
  assert.match(html, />3<\/text>/);
  assert.doesNotMatch(html, />2<\/text>/);
});

test("body rule contains overflow-wrap:anywhere (fix #2)", () => {
  const html = renderReport({
    snapshot, metrics, version: "0.1.10",
  });
  assert.match(html, /overflow-wrap:anywhere/);
});

test("data-v attribute hardened against non-finite values (fix #3)", () => {
  const testSnapshot = {
    ...snapshot,
    profile: { ...snapshot.profile, followers: '1" onmouseover="x' },
  };
  const html = renderNicheIndex("test", [{ href: "test/report.html", snapshot: testSnapshot, metrics }]);
  assert.doesNotMatch(html, /onmouseover="x/);
  assert.match(html, /data-v="-1"/);
});

test("footer contains version and capture time (fix #4)", () => {
  const html = renderReport({
    snapshot, metrics, version: "0.1.10",
  });
  assert.match(html, /jev-social 0\.1\.10 · captured 2026-09-27T18:00:00\.000Z/);
});
