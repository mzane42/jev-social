import assert from "node:assert/strict";
import test from "node:test";
import { classifyItems } from "../src/profile/analyze.js";
import { buildClassificationRequest, classificationText, createJevClassifier, loadDeck } from "../src/profile/adapters/jev-classifier.js";
import { createSqliteRepository, openDatabase } from "../src/profile/adapters/sqlite-repository.js";

const deck = { niche: "urbex", themes: { famous_place: "famous", other: "else" }, formats: { guided_visit: "tour", other: "else" }, version: "v1" };
const item = (n, caption = `J'explore ${n} #urbex créé par Lov avec son original`) => ({ url: `https://www.tiktok.com/@lov/video/${n}`, caption, topComments: [], durationSeconds: 60 });
const answer = (choice, confidence = 0.9) => ({ type: "choice", choice, confidence });

function fakeFiles() {
  const written = {};
  return { written, async writeIndex(rel, html) { written[rel] = html; return `/root/${rel}`; } };
}

test("sqlite repository keeps the latest report per account and writes html through files", async () => {
  const files = fakeFiles();
  const repo = createSqliteRepository({ db: openDatabase(":memory:"), files });
  const record = (capturedAt, followers) => ({ snapshot: { niche: "urbex", platform: "tiktok", handle: "lov", capturedAt, profile: { followers }, items: [] }, metrics: {}, insights: [], html: "<p>" });
  const { dir } = await repo.save(record("2026-09-27T10:00:00Z", 1));
  await repo.save(record("2026-09-28T10:00:00Z", 2));
  await repo.save(record("2026-09-28T12:00:00Z", 0));
  assert.equal(dir, "/root/urbex/tiktok@lov/2026-09-27");
  const latest = await repo.listLatest();
  assert.equal(latest.length, 1);
  assert.equal(latest[0].date, "2026-09-28");
  assert.equal(latest[0].data.snapshot.profile.followers, 0);
  assert.equal(latest[0].href, "tiktok@lov/2026-09-28/report.html");
  assert.ok(files.written["urbex/tiktok@lov/2026-09-28/report.html"]);
});

test("classification text drops the TikTok sound credit and skips items with nothing to read", () => {
  assert.deepEqual(classificationText(item(1)), { caption: "J'explore 1 #urbex", top_comments: [] });
  assert.equal(classificationText({ caption: null, topComments: [] }), null);
  const request = buildClassificationRequest("m", deck, item(1), classificationText(item(1)));
  assert.deepEqual(Object.keys(request.questions), ["theme", "format", "news"]);
  assert.ok(Object.hasOwn(request.questions.news.criteria, "evergreen"));
});

test("classifier asks one Jev call per readable item and rejects answers outside the deck", async () => {
  const calls = [];
  const reply = (answers) => Response.json({ model: "jev-x", answers });
  const classifier = createJevClassifier({
    apiKey: "k", provider: { kind: "openrouter", model: "jev" },
    async fetchImpl(url, init) {
      calls.push(JSON.parse(init.body));
      return !calls.at(-1).state.platform_item.caption.includes("2")
        ? reply({ theme: answer("famous_place"), format: answer("guided_visit", 0.7), news: answer("evergreen") })
        : reply({ theme: answer("invented"), format: answer("other"), news: answer("evergreen") });
    },
  });
  await assert.rejects(
    classifier.classify({ deck, items: [item(1), { url: "x", caption: null, topComments: [] }, item(2)] }),
    (error) => /invalid "theme"/.test(error.message) && error.partial.size === 1,
  );
  assert.equal(calls.length, 2);
  assert.ok(calls.every((body) => body.model === "jev"));
  const ok = await classifier.classify({ deck, items: [item(1)] });
  assert.deepEqual(ok.get(item(1).url).format, { value: "guided_visit", confidence: 0.7 });
  assert.equal(ok.get(item(1).url).model, "jev-x");
});

test("classifyItems caches by deck version, keeps partial results and never throws", async () => {
  const repo = createSqliteRepository({ db: openDatabase(":memory:"), files: fakeFiles() });
  const seen = [];
  const pick = (value) => ({ value, confidence: 0.9 });
  const one = { theme: pick("famous_place"), format: pick("other"), news: pick("evergreen"), model: "m" };
  const classifier = {
    async classify({ items }) {
      seen.push(items.map((entry) => entry.url));
      if (items.length > 1) throw Object.assign(new Error("down"), { partial: new Map([[items[0].url, one]]) });
      return new Map(items.map((entry) => [entry.url, one]));
    },
  };
  const deps = { classifier, repository: repo, loadDeck: async () => deck };
  const first = await classifyItems(deps, "urbex", [item(1), item(2)]);
  assert.deepEqual(first, { classified: 1, skipped: "Jev classification failed: down" });
  assert.deepEqual(await classifyItems(deps, "urbex", [item(1), item(2)]), { classified: 1, skipped: null });
  assert.deepEqual(seen.at(-1), [item(2).url]);
  assert.deepEqual(await classifyItems({ ...deps, loadDeck: async () => ({ ...deck, version: "v2" }) }, "urbex", [item(1)]), { classified: 1, skipped: null });
  assert.deepEqual(await classifyItems({ ...deps, classifier: null }, "urbex", [item(1)]), { classified: 0, skipped: "classification disabled" });
  assert.equal(repo.classifications("v1", "urbex").get(item(1).url).theme.value, "famous_place");
});

test("every shipped niche deck loads and has an 'other' fallback", async () => {
  for (const niche of ["football-anime", "piscine", "urbex", "cuisine"]) {
    const loaded = await loadDeck(niche);
    assert.ok(loaded.themes.other && loaded.formats.other, niche);
    assert.match(loaded.version, /^[0-9a-f]{12}$/);
  }
  assert.equal(await loadDeck("no-such-niche"), null);
});
