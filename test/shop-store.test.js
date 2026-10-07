import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createShopStore } from "../src/shop-store.js";

const product = { productId: "1729000000000000001", title: "Surmatelas", shortTitle: "Surmatelas", sellerId: "8647000000000000001", categories: ["Literie"], skuCount: 2, coverUrl: null, source: "TikTok Shop", url: "https://www.tiktok.com/view/product/1729000000000000001" };
const row = { url: "https://www.tiktok.com/@demo_seller/video/7001", videoId: "7001", handle: "demo_seller", caption: "x", createdAt: "2026-07-28T15:41:27.000Z", duration: 15, isEc: true, stats: { views: 100, likes: 1, comments: 2, shares: 3, saves: 4 }, mode: "tag", query: "surmatelas" };

test("upserts keep first_seen and move last_seen", () => {
  const store = createShopStore(new DatabaseSync(":memory:"));
  store.upsertProduct(product, "2026-10-07T07:30:00.000Z");
  store.upsertProduct({ ...product, title: "Surmatelas v2" }, "2026-10-08T07:30:00.000Z");
  const saved = store.db.prepare("SELECT title, first_seen, last_seen, categories FROM shop_products").get();
  assert.equal(saved.title, "Surmatelas v2");
  assert.equal(saved.first_seen, "2026-10-07T07:30:00.000Z");
  assert.equal(saved.last_seen, "2026-10-08T07:30:00.000Z");
  assert.deepEqual(JSON.parse(saved.categories), ["Literie"]);
});

test("videos link to a product and are counted as detailed for the day", () => {
  const store = createShopStore(new DatabaseSync(":memory:"));
  store.upsertProduct(product, "2026-10-07T07:30:00.000Z");
  store.upsertCreator({ handle: "demo_seller", followers: 1200 }, "2026-10-07T07:30:00.000Z");
  store.upsertVideo(row, product.productId, "2026-10-07T07:30:00.000Z");
  store.upsertVideo({ ...row, url: "https://www.tiktok.com/@demo_seller/video/7002", isEc: false }, null, "2026-10-07T07:30:00.000Z");
  store.snapshot("video", row.url, "2026-10-07", row.stats);
  assert.deepEqual([...store.detailedSince("2026-10-07")].sort(), [row.url, "https://www.tiktok.com/@demo_seller/video/7002"]);
  assert.equal(store.detailedSince("2026-10-08").size, 0);
  assert.deepEqual(store.counts("2026-10-07"), { videos: 2, products: 1, creators: 1 });
  const snap = store.db.prepare("SELECT views, saves FROM shop_snapshots WHERE kind = 'video'").get();
  assert.deepEqual({ ...snap }, { views: 100, saves: 4 }); // node:sqlite rows have a null prototype
});

test("snapshot of the same day overwrites", () => {
  const store = createShopStore(new DatabaseSync(":memory:"));
  store.snapshot("video", "u", "2026-10-07", { views: 1 });
  store.snapshot("video", "u", "2026-10-07", { views: 5 });
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM shop_snapshots").get().n, 1);
  assert.equal(store.db.prepare("SELECT views FROM shop_snapshots").get().views, 5);
});
