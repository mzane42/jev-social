import assert from "node:assert/strict";
import test from "node:test";
import { computeMetrics, parseCount, parseProfileTargets, parseProfileUrl, validateNiche, validateRange } from "../src/profile/domain.js";

test("parseCount reads socai count strings", () => {
  assert.equal(parseCount("2.2M"), 2_200_000);
  assert.equal(parseCount("320.8K"), 320_800);
  assert.equal(parseCount("1215"), 1215);
  assert.equal(parseCount("1,500"), 1500);
  assert.equal(parseCount(427000), 427000);
  assert.equal(parseCount(""), null);
  assert.equal(parseCount(null), null);
  assert.equal(parseCount("n/a"), null);
  assert.equal(parseCount(Number.NaN), null);
});

test("parseProfileUrl accepts TikTok and Instagram profiles only", () => {
  assert.deepEqual(parseProfileUrl("https://www.tiktok.com/@demo_creator?lang=fr"), {
    platform: "tiktok", handle: "demo_creator", url: "https://www.tiktok.com/@demo_creator",
  });
  assert.deepEqual(parseProfileUrl("https://instagram.com/demo.ig/"), {
    platform: "instagram", handle: "demo.ig", url: "https://www.instagram.com/demo.ig/",
  });
  for (const bad of [
    "http://www.tiktok.com/@demo", "https://evil.com/@demo", "https://www.tiktok.com/demo",
    "https://www.instagram.com/..", "https://www.instagram.com/a%2F..", "https://www.instagram.com/p",
    "not a url",
  ]) {
    assert.throws(() => parseProfileUrl(bad), { code: "INVALID_PROFILE_INPUT" }, bad);
  }
});

test("validateNiche and validateRange guard CLI input", () => {
  assert.equal(validateNiche("football-anime"), "football-anime");
  assert.throws(() => validateNiche("../x"), { code: "INVALID_PROFILE_INPUT" });
  assert.throws(() => validateNiche(undefined), { code: "INVALID_PROFILE_INPUT" });
  assert.equal(validateRange("--videos", 12, 1, 50), 12);
  assert.throws(() => validateRange("--videos", 0, 1, 50), /--videos must be an integer between 1 and 50/);
  assert.throws(() => validateRange("--deep", 1.5, 0, 10), { code: "INVALID_PROFILE_INPUT" });
});

const item = (url, fields = {}) => ({
  url, kind: "video", caption: null, createdAt: null, durationSeconds: null,
  views: null, likes: null, comments: null, shares: null, saves: null, topComments: [], ...fields,
});

test("computeMetrics derives medians, rates, outliers and cadence", () => {
  const metrics = computeMetrics({
    profile: { followers: 1000 },
    items: [
      item("a", { views: 100, likes: 10, shares: 5, createdAt: "2026-09-01T00:00:00Z" }),
      item("b", { views: 200, createdAt: "2026-09-08T00:00:00Z" }),
      item("c", { views: 5000, likes: 500, saves: 50, comments: 25, createdAt: "2026-09-15T00:00:00Z" }),
      item("d"),
    ],
  });
  assert.equal(metrics.medianViews, 200);
  assert.equal(metrics.viewsPerFollower, 0.2);
  assert.equal(metrics.bestItemUrl, "c");
  assert.deepEqual(metrics.outliers, ["c"]);
  assert.equal(metrics.postsPerWeek, 1);
  assert.deepEqual(metrics.items[0], { url: "a", likeRate: 0.1, shareRate: 0.05, saveRate: null, commentRate: null });
  assert.deepEqual(metrics.items[3], { url: "d", likeRate: null, shareRate: null, saveRate: null, commentRate: null });
});

test("computeMetrics returns nulls when inputs are missing", () => {
  const metrics = computeMetrics({ profile: { followers: 0 }, items: [item("x", { createdAt: "2026-09-01T00:00:00Z" })] });
  assert.equal(metrics.medianViews, null);
  assert.equal(metrics.viewsPerFollower, null);
  assert.equal(metrics.bestItemUrl, null);
  assert.deepEqual(metrics.outliers, []);
  assert.equal(metrics.postsPerWeek, null);
});

test("parseProfileTargets tries TikTok then Instagram for a bare handle, and keeps URLs as-is", () => {
  assert.deepEqual(parseProfileTargets("@demo.ig").map((target) => target.url), ["https://www.tiktok.com/@demo.ig", "https://www.instagram.com/demo.ig/"]);
  assert.deepEqual(parseProfileTargets("demo_creator").map((target) => target.platform), ["tiktok", "instagram"]);
  assert.deepEqual(parseProfileTargets("https://www.instagram.com/demo.ig/"), [parseProfileUrl("https://www.instagram.com/demo.ig/")]);
  for (const bad of ["@..", "@a/b", "", undefined]) assert.throws(() => parseProfileTargets(bad), { code: "INVALID_PROFILE_INPUT" }, String(bad));
});
