import test from "node:test";
import assert from "node:assert/strict";
import { castFrom, castIn, parseRss, priority } from "../src/radar.js";

test("parseRss reads CDATA titles, links and dates", () => {
  const xml = `<rss><channel><item><title><![CDATA[Mbappé &amp; Yamal clash]]></title><link>https://x.test/a</link>
    <pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate><description>&lt;b&gt;Row&lt;/b&gt; at training</description></item></channel></rss>`;
  const [item] = parseRss(xml, "Feed");
  assert.equal(item.title, "Mbappé & Yamal clash");
  assert.equal(item.link, "https://x.test/a");
  assert.equal(item.publishedAt, "2026-10-05T10:00:00.000Z");
  assert.equal(item.source, "Feed");
});

test("cast comes from registry tags and matches accent-free whole words", () => {
  const cast = castFrom("| @char_FMD_mbappe_anchor | @char_FMD_kane_knight | @char_FMD_mbappe_dictator |", ["Mourinho"]);
  assert.deepEqual(cast, ["mbappe", "kane", "mourinho"]);
  assert.deepEqual(castIn("Mbappé and Mourinho; Kanes tavern", cast), ["mbappe", "mourinho"]);
});

test("priority gates off-topic, halves rumors and favours the cast", () => {
  const strong = { is_football: "1", drama: "3", manga: "3", characters: "3", verifiability: "confirmed", risk: "0" };
  assert.equal(priority({ ...strong, is_football: "0" }, 2, 0), 0);
  assert.equal(priority(strong, 2, 0), 100);
  assert.equal(priority({ ...strong, verifiability: "rumor" }, 2, 0), 50);
  assert.ok(priority(strong, 0, 0) < priority(strong, 1, 0));
  assert.ok(priority(strong, 1, 70) < priority(strong, 1, 0));
});
