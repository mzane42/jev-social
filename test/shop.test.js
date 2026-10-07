import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { collectShop, localDate, parseBigJson, planQueries, shopAnchors, videoRow } from "../src/shop.js";
import { createShopStore } from "../src/shop-store.js";

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/shop/${name}`, import.meta.url), "utf8"));
const cfg = { global: ["tiktokshopfrance"], tags: ["surmatelas"], creators: ["demo_seller"], perQuery: 3, dailyCap: 300 };
const at = () => new Date("2026-10-07T07:30:00.000Z");

test("parseBigJson keeps 15+ digit ids as strings", () => {
  const v = parseBigJson('{"product_id":1729773076546100068,"n":12,"id": 8647628319979051876}');
  assert.equal(v.product_id, "1729773076546100068");
  assert.equal(v.id, "8647628319979051876");
  assert.equal(v.n, 12);
});

test("shopAnchors reads the anchor_shop payload and ignores CapCut anchors", async () => {
  const { videos } = await fixture("get-videos.json");
  const [shop] = shopAnchors(videos[0].entity);
  assert.deepEqual(shop, {
    productId: "1729000000000000001",
    title: "Surmatelas en fibre de bambou",
    shortTitle: "Surmatelas épais",
    sellerId: "8647000000000000001",
    categories: ["Textiles et ameublement", "Literie"],
    skuCount: 2,
    coverUrl: null,
    source: "TikTok Shop",
    url: "https://www.tiktok.com/view/product/1729000000000000001",
  });
  assert.deepEqual(shopAnchors(videos[1].entity), []);
  assert.deepEqual(shopAnchors({}), []);
});

test("videoRow normalises counts and flags", async () => {
  const { videos } = await fixture("get-videos.json");
  const row = videoRow(videos[0].entity, { mode: "tag", query: "surmatelas" });
  assert.equal(row.url, "https://www.tiktok.com/@demo_seller/video/7001");
  assert.equal(row.handle, "demo_seller");
  assert.equal(row.isEc, true);
  assert.deepEqual(row.stats, { views: 12400, likes: 7112, comments: 46, shares: 2282, saves: 2910 });
  assert.equal(row.mode, "tag");
  assert.equal(videoRow(videos[1].entity, { mode: "global", query: "x" }).isEc, false);
});

test("planQueries builds one socai call per watched search", () => {
  assert.deepEqual(planQueries(cfg), [
    { mode: "global", query: "tiktokshopfrance", args: ["tiktok", "search", "#tiktokshopfrance", "--num", "3", "--pretty"] },
    { mode: "tag", query: "surmatelas", args: ["tiktok", "search", "#surmatelas", "--num", "3", "--pretty"] },
    { mode: "creator", query: "demo_seller", args: ["tiktok", "author", "https://www.tiktok.com/@demo_seller", "--num", "3", "--pretty"] },
  ]);
});

test("collectShop searches, details once per URL, links products and writes the day file", async () => {
  const search = await fixture("search.json");
  const author = await fixture("author.json");
  const details = await fixture("get-videos.json");
  const calls = [];
  const runJson = async (args) => { calls.push(args); return args[1] === "search" ? search : args[1] === "author" ? author : details; };
  const store = createShopStore(new DatabaseSync(":memory:"));
  const outDir = await mkdtemp(path.join(tmpdir(), "shop-"));
  const result = await collectShop({ runJson, store, cfg, niche: "tiktok-shop-fr", outDir, now: at, sleep: async () => {}, random: () => 0 });

  assert.equal(calls.filter((a) => a[1] === "search").length, 2);
  assert.equal(calls.filter((a) => a[1] === "author").length, 1);
  const detail = calls.filter((a) => a[1] === "get-videos");
  assert.equal(detail.length, 1, "three distinct URLs fit in one batch of 5");
  assert.deepEqual(detail[0].slice(0, 2), ["tiktok", "get-videos"]);
  assert.equal(detail[0].filter((a) => a === "--video").length, 3);
  assert.ok(detail[0].includes("--num-comments") && !detail[0].includes("--download-media"));

  assert.equal(result.cards, 3);
  assert.equal(result.detailed, 3, "incomplete reads (missing comments) still count");
  assert.equal(result.partial, 1);
  assert.equal(result.products, 2);
  assert.deepEqual(result.discovered, ["demo_partial"]); // demo_seller is already watched; demo_other sells nothing
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /7003.*navigation_timeout/);
  assert.equal(store.db.prepare("SELECT product_id FROM shop_videos WHERE url LIKE '%7001'").get().product_id, "1729000000000000001");
  assert.equal(store.db.prepare("SELECT followers FROM shop_creators WHERE handle = 'demo_seller'").get().followers, 1200);

  const day = JSON.parse(await readFile(result.file, "utf8"));
  assert.equal(day.date, "2026-10-07");
  assert.equal(day.videos.length, 3);
  assert.match(day.partial[0], /7004: video_detail_incomplete \(top_comments\)/);
  assert.equal(day.products[0].productId, "1729000000000000001");
  assert.deepEqual(day.videos[0].topComments, [{ text: "Il est où le lien ?", likes: 12 }]);
  assert.deepEqual(Object.keys(day).sort(), ["creators", "date", "discovered", "errors", "modes", "niche", "partial", "products", "runAt", "usage", "videos"]);
});

test("collectShop skips URLs already detailed today and honours dailyCap", async () => {
  const search = await fixture("search.json");
  const details = await fixture("get-videos.json");
  const store = createShopStore(new DatabaseSync(":memory:"));
  store.upsertVideo({ url: "https://www.tiktok.com/@demo_seller/video/7001", videoId: "7001", handle: "demo_seller", caption: "", createdAt: null, duration: null, isEc: true, mode: "tag", query: "x" }, null, "2026-10-07T06:00:00.000Z");
  const calls = [];
  const runJson = async (args) => { calls.push(args); return args[1] === "search" ? search : details; };
  const outDir = await mkdtemp(path.join(tmpdir(), "shop-"));
  const result = await collectShop({ runJson, store, cfg: { ...cfg, creators: [], dailyCap: 1 }, niche: "t", outDir, now: at, sleep: async () => {}, random: () => 0 });
  const detail = calls.filter((a) => a[1] === "get-videos");
  assert.equal(detail[0].filter((a) => a === "--video").length, 1, "7001 skipped, cap 1 keeps only 7002");
  assert.equal(result.skipped, 1);
});

test("collectShop re-reads recent product videos not detailed today", async () => {
  const search = await fixture("search.json");
  const details = await fixture("get-videos.json");
  const store = createShopStore(new DatabaseSync(":memory:"));
  const url = "https://www.tiktok.com/@demo_seller/video/7001";
  const yesterday = "2026-10-06T07:30:00.000Z";
  store.upsertProduct({ productId: "1729000000000000001", title: "p", shortTitle: "p", url: "u", sellerId: null, categories: [], skuCount: 1, coverUrl: null, source: "TikTok Shop" }, yesterday);
  store.upsertVideo({ url, videoId: "7001", handle: "demo_seller", caption: "", createdAt: null, duration: null, isEc: true, mode: "tag", query: "x" }, "1729000000000000001", yesterday);
  store.snapshot("video", url, "2026-10-06", { views: 10 });
  const stale = "https://www.tiktok.com/@demo_seller/video/6999"; // product video but older than refreshDays
  store.upsertVideo({ url: stale, videoId: "6999", handle: "demo_seller", caption: "", createdAt: null, duration: null, isEc: true, mode: "tag", query: "x" }, "1729000000000000001", "2026-09-01T07:30:00.000Z");
  const calls = [];
  const runJson = async (args) => { calls.push(args); return args[1] === "search" ? { cards: [] } : details; };
  const outDir = await mkdtemp(path.join(tmpdir(), "shop-"));
  const result = await collectShop({ runJson, store, cfg: { ...cfg, creators: [] }, niche: "t", outDir, now: at, sleep: async () => {}, random: () => 0 });
  const videos = calls.filter((a) => a[1] === "get-videos").flatMap((a) => a.filter((_, i) => a[i - 1] === "--video"));
  assert.deepEqual(videos, [url], "only the recent product video is re-read");
  assert.equal(result.cards, 0);
  assert.equal(result.refreshed, 1);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM shop_snapshots WHERE kind = 'video' AND id = ?").get(url).n, 2, "one snapshot per day");
});

test("collectShop dry run only plans", async () => {
  const store = createShopStore(new DatabaseSync(":memory:"));
  const result = await collectShop({ runJson: async () => { throw new Error("must not run"); }, store, cfg, niche: "t", outDir: tmpdir(), now: at, dryRun: true });
  assert.equal(result.planned.length, 3);
  assert.equal(result.file, null);
});

test("collectShop aborts on a login gate", async () => {
  const store = createShopStore(new DatabaseSync(":memory:"));
  await assert.rejects(
    collectShop({ runJson: async () => ({ ok: false, login_required: true, cards: [] }), store, cfg, niche: "t", outDir: tmpdir(), now: at, sleep: async () => {} }),
    (error) => error.code === "SHOP_LOGIN_REQUIRED",
  );
});

test("collectShop reads the JSON socai attaches when it exits 1 on an incomplete batch", async () => {
  const search = await fixture("search.json");
  const details = await fixture("get-videos.json");
  const store = createShopStore(new DatabaseSync(":memory:"));
  const runJson = async (args) => {
    if (args[1] === "search") return search;
    const error = new Error("socai CLI failed: ok=false");
    error.code = "SOCAI_FAILED";
    error.details = { exitCode: 1, data: details };
    throw error;
  };
  const outDir = await mkdtemp(path.join(tmpdir(), "shop-"));
  const result = await collectShop({ runJson, store, cfg: { ...cfg, creators: [] }, niche: "t", outDir, now: at, sleep: async () => {}, random: () => 0 });
  assert.equal(result.detailed, 3);
  assert.equal(result.errors.length, 1, "only the video without an entity is an error");
});

test("day file uses the local calendar date", () => {
  const d = new Date(2026, 9, 7, 0, 39); // local midnight-ish, whatever the zone
  assert.equal(localDate(d), "2026-10-07");
});
