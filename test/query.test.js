import assert from "node:assert/strict";
import test from "node:test";
import { extractSearchQuery } from "../src/query.js";

test("extractSearchQuery removes English platform-routing language", () => {
  assert.equal(extractSearchQuery("search mr beasts on instagram"), "mr beasts");
  assert.equal(extractSearchQuery("Search for Mr Beast on Instagram"), "Mr Beast");
  assert.equal(extractSearchQuery("search Instagram for AI creators"), "AI creators");
  assert.equal(extractSearchQuery("find wearable reviews on TikTok and return 10 results"), "wearable reviews");
  assert.equal(extractSearchQuery("Find AI creators on TikTok, then return 10 results"), "AI creators");
  assert.equal(extractSearchQuery("Could you search Instagram for AI creators?"), "AI creators");
  assert.equal(extractSearchQuery("Could you please search Instagram for AI creators?"), "AI creators");
  assert.equal(extractSearchQuery("Find me AI creators on TikTok"), "AI creators");
  assert.equal(extractSearchQuery("Search for AI creators on Instagram please"), "AI creators");
  assert.equal(extractSearchQuery("Search Instagram for AI creators please"), "AI creators");
  assert.equal(extractSearchQuery("look up 'new design tools' on instagram"), "new design tools");
  assert.equal(extractSearchQuery("find AI product managers on LinkedIn"), "AI product managers");
  assert.equal(extractSearchQuery("search LinkedIn for staff engineers"), "staff engineers");
  assert.equal(extractSearchQuery("find handmade art on Instagram and open one relevant post to read its comments"), "handmade art");
  assert.equal(extractSearchQuery("Find handmade art on Instagram. Open one relevant post and read its comments, then finish."), "handmade art");
});

test("extractSearchQuery removes Chinese platform-routing language", () => {
  assert.equal(extractSearchQuery("在 Instagram 搜索 Mr Beast"), "Mr Beast");
  assert.equal(
    extractSearchQuery("在 TikTok 上搜索 AI wearable creators，返回 10 条高质量结果"),
    "AI wearable creators",
  );
  assert.equal(extractSearchQuery("搜索 Instagram 上的 Mr Beast"), "Mr Beast");
  assert.equal(extractSearchQuery("在 TikTok 上帮我搜索 AI creators，返回 10 条结果"), "AI creators");
  assert.equal(extractSearchQuery("请帮我搜索一下 Instagram 上的 AI creators"), "AI creators");
  assert.equal(extractSearchQuery("在 TikTok 上搜索 AI creators 返回 10 条结果"), "AI creators");
  assert.equal(extractSearchQuery("在 TikTok 搜索 AI creators 并返回 10 条结果"), "AI creators");
  assert.equal(extractSearchQuery("在 LinkedIn 搜索 AI product managers"), "AI product managers");
  assert.equal(extractSearchQuery("在 Instagram 搜索 handmade art。打开一个帖子"), "handmade art");
});

test("extractSearchQuery preserves an already literal search term", () => {
  assert.equal(extractSearchQuery("instagram marketing tips"), "instagram marketing tips");
  assert.equal(extractSearchQuery("mr beast"), "mr beast");
});

test("extractSearchQuery trims long quote runs without changing the topic", () => {
  const quotes = "\"".repeat(10_000);
  assert.equal(extractSearchQuery(`search Instagram for ${quotes}AI creators${quotes}`), "AI creators");
});
