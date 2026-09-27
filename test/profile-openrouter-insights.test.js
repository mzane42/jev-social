import assert from "node:assert/strict";
import test from "node:test";
import { buildInsightPayload, createOpenRouterInsights, validateInsights } from "../src/profile/adapters/openrouter-insights.js";

const snapshot = {
  platform: "tiktok", handle: "demo_creator", niche: "football-anime",
  profile: { displayName: "Demo", bio: "bio /Users/someone/secret.txt", followers: 1000, likes: null, postCount: 3 },
  items: [
    { url: "https://www.tiktok.com/@demo_creator/video/1", kind: "video", caption: "x".repeat(400), createdAt: null, durationSeconds: 30,
      views: 100, likes: 10, comments: 1, shares: 2, saves: 3,
      topComments: Array.from({ length: 7 }, (_, index) => ({ text: `c${index} ${"y".repeat(250)}`, likes: index })) },
  ],
};
const metrics = { medianViews: 100, viewsPerFollower: 0.1, bestItemUrl: snapshot.items[0].url, outliers: [], postsPerWeek: null, items: [] };

test("buildInsightPayload is bounded and path-free", () => {
  const payload = buildInsightPayload(snapshot, metrics);
  assert.equal(payload.items[0].caption.length, 300);
  assert.equal(payload.items[0].topComments.length, 5);
  assert.ok(payload.items[0].topComments.every((entry) => entry.text.length <= 200));
  assert.doesNotMatch(JSON.stringify(payload), /\/Users\/someone/);
  assert.equal(payload.metrics.medianViews, 100);
});

test("buildInsightPayload omits fields that were not captured instead of sending null", () => {
  const uncaptured = {
    ...snapshot,
    items: [
      { url: "https://www.tiktok.com/@demo_creator/video/2", kind: "video", caption: null, createdAt: null, durationSeconds: null,
        views: null, likes: null, comments: null, shares: null, saves: null, topComments: [] },
    ],
  };
  const payload = buildInsightPayload(uncaptured, metrics);
  const item = payload.items[0];
  assert.deepEqual(Object.keys(item).sort(), ["url"]);
  assert.ok(!("caption" in item));
  assert.ok(!("views" in item));
  assert.ok(!("topComments" in item));
});

test("validateInsights keeps only insights citing captured items", () => {
  const url = snapshot.items[0].url;
  const result = validateInsights({
    insights: [
      { title: "Good", body: "Cited", sources: [url, url, "https://evil.example/x"] },
      { title: "Foreign", body: "Nope", sources: ["https://evil.example/x"] },
      { title: "", body: "Untitled", sources: [url] },
      { title: "Uncited", body: "No sources" },
    ],
  }, snapshot);
  assert.deepEqual(result, [{ title: "Good", body: "Cited", sources: [url] }]);
  assert.deepEqual(validateInsights("garbage", snapshot), []);
});

test("validateInsights filters invalid entries before capping at 6 and caps sources at 5", () => {
  const okSnapshot = {
    ...snapshot,
    items: Array.from({ length: 8 }, (_, index) => ({ ...snapshot.items[0], url: `https://www.tiktok.com/@demo_creator/video/${index}` })),
  };
  const urls = okSnapshot.items.map((item) => item.url);
  const raw = {
    insights: [
      { title: "", body: "invalid, dropped", sources: [urls[0]] },
      ...Array.from({ length: 7 }, (_, index) => ({ title: `Insight ${index}`, body: "b", sources: urls })),
    ],
  };
  const result = validateInsights(raw, okSnapshot);
  assert.equal(result.length, 6);
  assert.deepEqual(result.map((entry) => entry.title), ["Insight 0", "Insight 1", "Insight 2", "Insight 3", "Insight 4", "Insight 5"]);
  assert.ok(result.every((entry) => entry.sources.length === 5));
});

test("write returns null when disabled and never calls the network", async () => {
  const fetchImpl = () => assert.fail("fetch must not run");
  assert.equal(await createOpenRouterInsights({ apiKey: "k", model: "off", fetchImpl }).write({ snapshot, metrics }), null);
  assert.equal(await createOpenRouterInsights({ apiKey: "", model: "m", fetchImpl }).write({ snapshot, metrics }), null);
});

test("write parses the model JSON and validates citations", async () => {
  const url = snapshot.items[0].url;
  let request;
  const fetchImpl = async (endpoint, init) => {
    request = { endpoint, body: JSON.parse(init.body), auth: init.headers.Authorization };
    const content = JSON.stringify({ insights: [{ title: "Hook", body: "Works", sources: [url] }] });
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
  const insights = await createOpenRouterInsights({ apiKey: "k", model: "openai/gpt-4o-mini", fetchImpl }).write({ snapshot, metrics });
  assert.equal(request.endpoint, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(request.body.model, "openai/gpt-4o-mini");
  assert.deepEqual(request.body.response_format, { type: "json_object" });
  assert.equal(request.auth, "Bearer k");
  assert.match(request.body.messages[0].content, /never infer the creator omitted it or that it is zero/);
  assert.deepEqual(insights, [{ title: "Hook", body: "Works", sources: [url] }]);
});

test("write throws on HTTP errors", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: "no credits" } }), { status: 402 });
  await assert.rejects(createOpenRouterInsights({ apiKey: "k", model: "m", fetchImpl }).write({ snapshot, metrics }), /no credits/);
});
