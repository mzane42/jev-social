import test from "node:test";
import assert from "node:assert/strict";
import { ageDays, castHits, collectBrief, headline, parseAtom, parseCount, parseNetflixTop10, parseTrends24, renderBrief, socialCheck } from "../src/brief.js";

test("parsers read trends24, Netflix TSV, Reddit Atom and TikTok counts", () => {
  assert.deepEqual(parseTrends24(`<a class=trend-link>#LIVMCI</a><a class=trend-link>Vinicius</a><a class=trend-link>#LIVMCI</a>`), ["#LIVMCI", "Vinicius"]);
  const tsv = "week\tcategory\tweekly_rank\tshow_title\tseason_title\n2026-10-04\tTV (English)\t1\tEast of Eden\tN/A\n2026-10-04\tTV (English)\t9\tX\tN/A\n2026-09-27\tTV (English)\t1\tOld\tN/A";
  assert.deepEqual(parseNetflixTop10(tsv, 3).map((r) => r.title), ["East of Eden"]);
  assert.deepEqual(parseAtom(`<feed><entry><title>Vini &quot;red&quot;</title><link href="https://r.test/1" /></entry></feed>`), [{ title: 'Vini "red"', link: "https://r.test/1" }]);
  assert.equal(parseAtom(`<entry><title>a &amp;lt;b&amp;gt;</title></entry>`)[0].title, "a &lt;b&gt;");
  assert.equal(parseCount("127.3K"), 127_300);
  assert.equal(parseCount("1,2M"), 1_200_000);
  assert.equal(parseCount(""), 0);
  assert.equal(ageDays("7679220776813366551", Date.UTC(2026, 9, 13)), 45);
  assert.deepEqual(castHits("Vinícius red card", ["Vinicius", "Mbappé"]), ["Vinicius"]);
});

test("socialCheck refuses to run while socai is busy and always stops socai otherwise", async () => {
  let searched = 0, stopped = 0;
  const skipped = await socialCheck({ queries: ["a"], busy: async () => "socai busy", search: async () => searched++, stop: async () => stopped++ });
  assert.equal(skipped.skipped, "socai busy");
  assert.equal(searched + stopped, 0);
  const ran = await socialCheck({ queries: ["a", "b"], busy: async () => null, stop: async () => stopped++,
    search: async (q) => { if (q === "b") throw new Error("boom"); return { data: { cards: [{ url: "u", views: "", title: "t", author: "x", video_id: "7679220776813366551" }, { url: "v", views: "2K", title: "t", author: "y" }] } }; } });
  assert.equal(stopped, 1);
  assert.deepEqual(ran.results[0].cards.map((c) => c.views), [2000, 0]);
  assert.match(ran.results[1].error, /boom/);
});

test("renderBrief keeps the attention-not-virality warning and lists missing sources", () => {
  const b = { date: "2026-10-13", matches: [{ date: "2026-10-14T19:00Z", name: "Paris Saint-Germain at Manchester City", league: "uefa.champions" }], radar: [], google: [], x: {}, reddit: [], wiki: {}, netflix: [], hashtags: [], missing: ["Reddit"], castInTrends: ["Vinicius"] };
  const md = renderBrief(b, { social: { skipped: "socai busy", results: [] } });
  assert.match(md, /pas de viralité/);
  assert.match(md, /Sources muettes ce matin : Reddit/);
  assert.match(md, /non fait : collecte socai en cours/);
  assert.match(headline(b), /En tendance : Vinicius · Prochain : Paris Saint-Germain at Manchester City/);
});

test("telegramDigest escapes HTML and stays under Telegram's limit", async () => {
  const { telegramDigest } = await import("../src/brief.js");
  const b = { date: "2026-10-13", castInTrends: ["Vinicius"], matches: [], radar: Array.from({ length: 50 }, () => ({ title: "A <b> & ".repeat(40), link: "https://x.test/?a=1&b=2", score: 41 })), x: {}, reddit: [], missing: [] };
  const text = telegramDigest(b);
  assert.ok(text.length <= 4000);
  assert.match(text, /A &lt;b&gt; &amp;/);
  assert.doesNotMatch(text, /<b> &/);
  const quoted = telegramDigest({ ...b, radar: [{ title: "t", link: 'https://x.test/"onmouseover="x', score: 1 }] });
  assert.match(quoted, /href="https:\/\/x\.test\/&quot;onmouseover=&quot;x"/);
});

test("collectBrief works on a fresh database where radar never ran", async () => {
  const { openDatabase } = await import("../src/profile/adapters/sqlite-repository.js");
  const b = await collectBrief({ db: openDatabase(":memory:"), deck: { niche: "football-anime", brief: { leagues: [], xCountries: [], wiki: [] } }, fetchImpl: async () => ({ ok: false }) });
  assert.deepEqual(b.radar, []);
});
