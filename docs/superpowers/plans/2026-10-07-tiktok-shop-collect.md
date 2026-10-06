# TikTok Shop Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `jev-social shop collect --niche tiktok-shop-fr` collects, once a day, the TikTok videos that sell a product (global hashtags, tags, watched creators), links product and creator, writes `~/.jev-social/shop/YYYY-MM-DD.json` and upserts four SQLite tables.

**Architecture:** Flat modules in `src/` like `radar.js`: pure parsing in `shop.js`, SQLite in `shop-store.js`, orchestration `collectShop()` takes an injected `runJson(args)` (same seam as `createSocaiCollector`) so tests use fixtures. The CLI branch in `bin/jev-social.js` wires `createSocaiRunJson`, `openDatabase`, a busy guard and `socai stop`.

**Tech Stack:** Node ≥22 ESM, zero runtime dependencies, `node:sqlite` `DatabaseSync`, `node --test` + `node:assert/strict`. socai binary `~/.socai/bin/socai.0.6.5-anchors` (fork branch `feat/tiktok-anchors`, exposes `entity.anchors` and `entity.is_ec_video`).

Spec: `docs/superpowers/specs/2026-10-07-tiktok-shop-collect-design.md`.

## Global Constraints

- No new npm dependencies. New `src/*.js` files are added to the `check` script in `package.json`.
- socai child env always `SOCAI_TELEMETRY=0 SOCAI_TELEMETRY_QUERY_TEXT=off SOCAI_NO_UPDATE_CHECK=1` (comes from `createSocaiRunJson`).
- Never pass `--download-media` or `--transcribe-audio`.
- `tiktok get-videos` takes full URLs `https://www.tiktok.com/@h/video/<id>`, never bare ids. Up to 5 `--video` per call.
- Product, seller and SKU ids exceed 2^53: quote 15+ digit integers before `JSON.parse`, keep ids as strings.
- One socai Chrome for all sessions: the collect command skips when another collection runs or a `~/.socai/runs/*` entry is younger than 10 minutes, and ends with `socai stop`.
- Rate: `perQuery` cards per query (default 20), `dailyCap` detailed videos per day (default 300), random 3 to 9 s pause between `get-videos` batches.
- Fixtures are anonymised: handles `demo_seller`, ids like `1729000000000000001`, no CDN URLs.
- Commits end with the two attribution lines given in the session (Co-Authored-By + Claude-Session).

## File Map

| File | Responsibility |
|---|---|
| `src/shop.js` | `parseBigJson`, `shopAnchors(entity)`, `videoRow(entity, meta)`, `planQueries(cfg)`, `collectShop(deps)` |
| `src/shop-store.js` | `SHOP_SCHEMA`, `createShopStore(db)` upserts and day lookups |
| `src/shop-guard.js` | `socaiBusy({ runsDir, pgrep, now })` |
| `niches/tiktok-shop-fr.json` | watch config (`shop` key) |
| `bin/jev-social.js` (modify) | `shop collect` branch, `--dry-run` flag, help line |
| `package.json` (modify) | `check` script |
| `test/shop.test.js`, `test/shop-store.test.js`, `test/shop-guard.test.js` | unit tests |
| `test/fixtures/shop/get-videos.json`, `test/fixtures/shop/search.json`, `test/fixtures/shop/author.json` | anonymised socai outputs |
| `scripts/launchd/com.mzane42.jev-shop-collect.plist` | daily job template (installed by hand) |
| `docs/GUIDE-LOCAL.md` (modify) | "8 octies. Veille TikTok Shop" |

---

### Task 1: Anchor parsing and video rows (`src/shop.js`, pure part)

**Files:**
- Create: `src/shop.js`
- Create: `test/fixtures/shop/get-videos.json`
- Test: `test/shop.test.js`

**Interfaces:**
- Produces:
  - `parseBigJson(text: string) → any` (ids ≥15 digits become strings)
  - `shopAnchors(entity) → Array<{ productId, title, shortTitle, sellerId|null, categories: string[], skuCount, coverUrl|null, source, url }>`
  - `videoRow(entity, { mode, query }) → { url, videoId, handle, caption, createdAt, duration, isEc, stats: { views, likes, comments, shares, saves }, mode, query }`

- [ ] **Step 1: Write the fixture** `test/fixtures/shop/get-videos.json` (shape of the real patched output, anonymised; the inner `extra` strings are JSON-encoded strings exactly like TikTok emits them):

```json
{
  "count": 3, "failures": 1, "ok": false,
  "videos": [
    {
      "ok": true, "locator": "https://www.tiktok.com/@demo_seller/video/7001",
      "entity": {
        "entity_type": "video", "platform": "tiktok", "video_id": "7001",
        "url": "https://www.tiktok.com/@demo_seller/video/7001",
        "description": "Mon lit est devenu tellement plus moelleux ! #Surmatelas #TikTokShopFrance",
        "created_at": "2026-07-28T15:41:27.000Z", "duration_seconds": 15,
        "author": "Demo Seller", "author_id": "demo_seller", "author_url": "https://www.tiktok.com/@demo_seller",
        "likes": "7112", "comments_count": "46", "shares": "2282", "favorites": "2910", "views": "12.4K",
        "is_ec_video": 1,
        "anchors": [
          { "type": 35, "extra": "[{\"keyword\":\"Surmatelas épais\",\"id\":1729000000000000001,\"type\":33,\"component_key\":\"anchor_shop\",\"extra\":\"{\\\"product_id\\\":1729000000000000001,\\\"title\\\":\\\"Surmatelas en fibre de bambou\\\",\\\"elastic_title\\\":\\\"Surmatelas épais\\\",\\\"seller_id\\\":8647000000000000001,\\\"source\\\":\\\"TikTok Shop\\\",\\\"price\\\":0,\\\"currency\\\":\\\"EUR\\\",\\\"cover_url\\\":\\\"\\\",\\\"skus\\\":[{\\\"sku_id\\\":1729000000000000101},{\\\"sku_id\\\":1729000000000000102}],\\\"categories\\\":[{\\\"category_id\\\":600154,\\\"category_name\\\":\\\"Textiles et ameublement\\\",\\\"level\\\":1},{\\\"category_id\\\":808328,\\\"category_name\\\":\\\"Literie\\\",\\\"level\\\":2}]}\"}]" }
        ],
        "top_comments": []
      }
    },
    {
      "ok": true, "locator": "https://www.tiktok.com/@demo_other/video/7002",
      "entity": {
        "entity_type": "video", "platform": "tiktok", "video_id": "7002",
        "url": "https://www.tiktok.com/@demo_other/video/7002",
        "description": "Les 5 niches qui explosent #ecommerce", "created_at": "2026-10-01T10:00:00.000Z", "duration_seconds": 60,
        "author": "Demo Other", "author_id": "demo_other", "author_url": "https://www.tiktok.com/@demo_other",
        "likes": "10", "comments_count": "0", "shares": "1", "favorites": "2", "views": "2006",
        "is_ec_video": 0,
        "anchors": [ { "type": 54, "keyword": "CapCut", "extra": "" } ],
        "top_comments": []
      }
    },
    { "ok": false, "locator": "https://www.tiktok.com/@demo_gone/video/7003", "error": "navigation_timeout", "reason": "video_read_failed" }
  ]
}
```

- [ ] **Step 2: Write the failing tests** `test/shop.test.js`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseBigJson, shopAnchors, videoRow } from "../src/shop.js";

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/shop/${name}`, import.meta.url), "utf8"));

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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/shop.test.js`
Expected: FAIL, `Cannot find module '.../src/shop.js'`

- [ ] **Step 4: Write `src/shop.js` (pure part)**

```js
import { parseCount } from "./profile/domain.js";

// TikTok Shop watch: search/author cards → get-videos details → anchors → products, creators, videos.
// Config: `shop` key of niches/<niche>.json ({ global, tags, creators, perQuery, dailyCap }).

const BIG_INT = /("(?:product_id|seller_id|sku_id|id)"\s*:\s*)(\d{15,})/g;

/** JSON.parse that keeps TikTok's 19-digit ids as strings (they exceed 2^53). */
export const parseBigJson = (text) => JSON.parse(String(text).replace(BIG_INT, '$1"$2"'));

const parseMaybe = (value) => {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return null;
  try { return parseBigJson(value); } catch { return null; }
};

/** Shop products tagged on a video. Source: itemStruct.anchors[i].extra (JSON string) → [{type 33, component_key "anchor_shop", extra}]. */
export function shopAnchors(entity) {
  const out = [];
  for (const anchor of Array.isArray(entity?.anchors) ? entity.anchors : []) {
    const list = parseMaybe(anchor?.extra);
    for (const item of Array.isArray(list) ? list : []) {
      if (item?.component_key !== "anchor_shop") continue;
      const ex = parseMaybe(item.extra) ?? {};
      const productId = String(ex.product_id ?? item.id ?? "");
      if (!productId) continue;
      out.push({
        productId,
        title: ex.title || item.keyword || "",
        shortTitle: ex.elastic_title || item.keyword || "",
        sellerId: ex.seller_id ? String(ex.seller_id) : null,
        categories: (Array.isArray(ex.categories) ? ex.categories : []).map((c) => c?.category_name).filter(Boolean),
        skuCount: Array.isArray(ex.skus) ? ex.skus.length : 0,
        coverUrl: ex.cover_url || null,
        source: ex.source || "TikTok Shop",
        url: `https://www.tiktok.com/view/product/${productId}`,
      });
    }
  }
  return out;
}

export function videoRow(entity, { mode, query }) {
  return {
    url: entity.url,
    videoId: String(entity.video_id ?? ""),
    handle: entity.author_id || "",
    caption: entity.description || entity.title || "",
    createdAt: entity.created_at || null,
    duration: Number(entity.duration_seconds) || null,
    isEc: Number(entity.is_ec_video) === 1,
    stats: {
      views: parseCount(entity.views),
      likes: parseCount(entity.likes),
      comments: parseCount(entity.comments_count),
      shares: parseCount(entity.shares),
      saves: parseCount(entity.favorites),
    },
    mode,
    query,
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/shop.test.js`
Expected: `# pass 3`

- [ ] **Step 6: Commit**

```bash
git add src/shop.js test/shop.test.js test/fixtures/shop/get-videos.json
git commit -m "feat(shop): parse TikTok Shop anchors and video rows"
```

---

### Task 2: SQLite store (`src/shop-store.js`)

**Files:**
- Create: `src/shop-store.js`
- Test: `test/shop-store.test.js`

**Interfaces:**
- Consumes: `openDatabase(file)` from `src/profile/adapters/sqlite-repository.js` (tests use `new DatabaseSync(":memory:")`).
- Produces: `createShopStore(db) → { upsertProduct(p, at), upsertCreator(c, at), upsertVideo(row, productId, at), snapshot(kind, id, date, stats), detailedSince(date) → Set<string>, counts(date) → { videos, products, creators } }`
  - `p` is one element of `shopAnchors()`; `c` is `{ handle, displayName?, followers? }`; `row` is a `videoRow()`; `at` is an ISO string; `date` is `YYYY-MM-DD`.

- [ ] **Step 1: Write the failing tests** `test/shop-store.test.js`:

```js
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
  assert.deepEqual(snap, { views: 100, saves: 4 });
});

test("snapshot of the same day overwrites", () => {
  const store = createShopStore(new DatabaseSync(":memory:"));
  store.snapshot("video", "u", "2026-10-07", { views: 1 });
  store.snapshot("video", "u", "2026-10-07", { views: 5 });
  assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM shop_snapshots").get().n, 1);
  assert.equal(store.db.prepare("SELECT views FROM shop_snapshots").get().views, 5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/shop-store.test.js`
Expected: FAIL, `Cannot find module '.../src/shop-store.js'`

- [ ] **Step 3: Write `src/shop-store.js`**

```js
// SQLite tables for the TikTok Shop watch. Lazy CREATE, same database as reports (node:sqlite).

export const SHOP_SCHEMA = `
CREATE TABLE IF NOT EXISTS shop_products (
  product_id TEXT PRIMARY KEY, title TEXT, short_title TEXT, url TEXT, seller_id TEXT, categories TEXT NOT NULL DEFAULT '[]',
  sku_count INTEGER, cover_url TEXT, source TEXT, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, jev TEXT
);
CREATE TABLE IF NOT EXISTS shop_creators (
  handle TEXT PRIMARY KEY, display_name TEXT, followers INTEGER, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  watched INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS shop_videos (
  url TEXT PRIMARY KEY, video_id TEXT, handle TEXT, product_id TEXT, is_ec INTEGER NOT NULL DEFAULT 0, caption TEXT,
  created_at TEXT, duration INTEGER, mode TEXT, query TEXT, first_seen TEXT NOT NULL, detailed_at TEXT NOT NULL, jev TEXT
);
CREATE TABLE IF NOT EXISTS shop_snapshots (
  date TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL,
  views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, saves INTEGER, followers INTEGER, sold_text TEXT, price TEXT,
  PRIMARY KEY (date, kind, id)
);`;

export function createShopStore(db) {
  db.exec(SHOP_SCHEMA);
  const product = db.prepare(`INSERT INTO shop_products (product_id, title, short_title, url, seller_id, categories, sku_count, cover_url, source, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (product_id) DO UPDATE SET title = excluded.title, short_title = excluded.short_title, seller_id = excluded.seller_id,
      categories = excluded.categories, sku_count = excluded.sku_count, cover_url = excluded.cover_url, last_seen = excluded.last_seen`);
  const creator = db.prepare(`INSERT INTO shop_creators (handle, display_name, followers, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (handle) DO UPDATE SET display_name = COALESCE(excluded.display_name, shop_creators.display_name),
      followers = COALESCE(excluded.followers, shop_creators.followers), last_seen = excluded.last_seen`);
  const video = db.prepare(`INSERT INTO shop_videos (url, video_id, handle, product_id, is_ec, caption, created_at, duration, mode, query, first_seen, detailed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (url) DO UPDATE SET product_id = COALESCE(excluded.product_id, shop_videos.product_id), is_ec = excluded.is_ec,
      caption = excluded.caption, detailed_at = excluded.detailed_at`);
  const snap = db.prepare(`INSERT INTO shop_snapshots (date, kind, id, views, likes, comments, shares, saves, followers, sold_text, price)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (date, kind, id) DO UPDATE SET views = excluded.views, likes = excluded.likes, comments = excluded.comments,
      shares = excluded.shares, saves = excluded.saves, followers = excluded.followers, sold_text = excluded.sold_text, price = excluded.price`);
  const detailed = db.prepare("SELECT url FROM shop_videos WHERE detailed_at >= ?");
  const count = (sql) => db.prepare(sql);
  const counts = {
    videos: count("SELECT COUNT(*) AS n FROM shop_videos WHERE detailed_at >= ?"),
    products: count("SELECT COUNT(*) AS n FROM shop_products WHERE last_seen >= ?"),
    creators: count("SELECT COUNT(*) AS n FROM shop_creators WHERE last_seen >= ?"),
  };
  const n = (v) => (v == null ? null : v);
  return {
    db,
    upsertProduct: (p, at) => product.run(p.productId, p.title, p.shortTitle, p.url, p.sellerId, JSON.stringify(p.categories ?? []), p.skuCount ?? null, p.coverUrl, p.source, at, at),
    upsertCreator: (c, at) => creator.run(c.handle, c.displayName ?? null, n(c.followers), at, at),
    upsertVideo: (row, productId, at) => video.run(row.url, row.videoId, row.handle, productId, row.isEc ? 1 : 0, row.caption, row.createdAt, row.duration, row.mode, row.query, at, at),
    snapshot: (kind, id, date, s = {}) => snap.run(date, kind, id, n(s.views), n(s.likes), n(s.comments), n(s.shares), n(s.saves), n(s.followers), s.soldText ?? null, s.price ?? null),
    detailedSince: (date) => new Set(detailed.all(date).map((r) => r.url)),
    counts: (date) => Object.fromEntries(Object.entries(counts).map(([k, q]) => [k, q.get(date).n])),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/shop-store.test.js`
Expected: `# pass 3`

- [ ] **Step 5: Commit**

```bash
git add src/shop-store.js test/shop-store.test.js
git commit -m "feat(shop): SQLite tables for products, creators, videos, snapshots"
```

---

### Task 3: `collectShop()` orchestration

**Files:**
- Modify: `src/shop.js` (append)
- Create: `test/fixtures/shop/search.json`, `test/fixtures/shop/author.json`
- Test: `test/shop.test.js` (append)

**Interfaces:**
- Consumes: `shopAnchors`, `videoRow` (Task 1); `createShopStore(db)` (Task 2).
- Produces:
  - `planQueries(cfg) → Array<{ mode: "global"|"tag"|"creator", query: string, args: string[] }>`
  - `collectShop({ runJson, store, cfg, niche, outDir, now?, sleep?, random?, log?, dryRun? }) → Promise<{ date, file|null, planned, cards, detailed, products, creators, discovered, errors, skipped }>`
  - Throws `AppError` with code `SHOP_LOGIN_REQUIRED` on a login/captcha gate.

- [ ] **Step 1: Write fixtures**

`test/fixtures/shop/search.json`:

```json
{ "ok": true, "query": "#tiktokshopfrance", "count": 3, "cards": [
  { "url": "https://www.tiktok.com/@demo_seller/video/7001", "author_id": "demo_seller", "title": "Mon lit #TikTokShopFrance", "views": "12.4K", "position": 0 },
  { "url": "https://www.tiktok.com/@demo_other/video/7002", "author_id": "demo_other", "title": "Les 5 niches", "views": "2006", "position": 1 },
  { "url": "https://www.tiktok.com/@demo_gone/video/7003", "author_id": "demo_gone", "title": "gone", "views": "", "position": 2 }
] }
```

`test/fixtures/shop/author.json`:

```json
{ "ok": true, "profile": { "display_name": "Demo Seller", "bio": "", "followers": "1200", "likes": "9000", "video_count": "40",
  "video_cards": [ { "video_id": "7001", "url": "https://www.tiktok.com/@demo_seller/video/7001", "title": "Mon lit", "views": "12.4K" } ] } }
```

- [ ] **Step 2: Write the failing tests** (append to `test/shop.test.js`):

```js
import { mkdtemp, readFile as readText } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { collectShop, planQueries } from "../src/shop.js";
import { createShopStore } from "../src/shop-store.js";

const cfg = { global: ["tiktokshopfrance"], tags: ["surmatelas"], creators: ["demo_seller"], perQuery: 3, dailyCap: 300 };
const at = () => new Date("2026-10-07T07:30:00.000Z");

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
  assert.equal(result.detailed, 2);
  assert.equal(result.products, 1);
  assert.deepEqual(result.discovered, []); // demo_seller is already watched; demo_other sells nothing
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /7003.*navigation_timeout/);
  assert.equal(store.db.prepare("SELECT product_id FROM shop_videos WHERE url LIKE '%7001'").get().product_id, "1729000000000000001");
  assert.equal(store.db.prepare("SELECT followers FROM shop_creators WHERE handle = 'demo_seller'").get().followers, 1200);

  const day = JSON.parse(await readText(result.file, "utf8"));
  assert.equal(day.date, "2026-10-07");
  assert.equal(day.videos.length, 2);
  assert.equal(day.products[0].productId, "1729000000000000001");
  assert.deepEqual(Object.keys(day).sort(), ["creators", "date", "discovered", "errors", "modes", "niche", "products", "runAt", "usage", "videos"]);
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test test/shop.test.js`
Expected: FAIL, `planQueries is not a function` / `collectShop is not a function`

- [ ] **Step 4: Append to `src/shop.js`**

```js
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors.js";

const BATCH = 5;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function planQueries(cfg) {
  const num = String(cfg.perQuery ?? 20);
  const search = (mode) => (tag) => ({ mode, query: tag, args: ["tiktok", "search", `#${tag}`, "--num", num, "--pretty"] });
  return [
    ...(cfg.global ?? []).map(search("global")),
    ...(cfg.tags ?? []).map(search("tag")),
    ...(cfg.creators ?? []).map((handle) => ({ mode: "creator", query: handle, args: ["tiktok", "author", `https://www.tiktok.com/@${handle}`, "--num", num, "--pretty"] })),
  ];
}

const gated = (raw) => {
  const observed = raw?.state?.observed_state;
  return Boolean(raw?.login_required || raw?.challenge_required || observed?.login_required || observed?.challenge_required);
};

export async function collectShop({ runJson, store, cfg, niche, outDir, now = () => new Date(), sleep = defaultSleep, random = Math.random, log = () => {}, dryRun = false }) {
  const planned = planQueries(cfg);
  if (dryRun) return { date: null, file: null, planned, cards: 0, detailed: 0, products: 0, creators: 0, discovered: [], errors: [], skipped: 0 };

  const runAt = now();
  const at = runAt.toISOString();
  const date = at.slice(0, 10);
  const errors = [];
  const modes = [];
  const candidates = new Map(); // url → { mode, query }
  const usage = { searches: 0, details: 0 };

  for (const plan of planned) {
    let raw;
    try {
      raw = await runJson(plan.args);
      usage.searches += 1;
    } catch (error) {
      errors.push(`${plan.mode} ${plan.query}: ${error.message}`);
      log(`shop: ${plan.mode} ${plan.query} skipped (${error.message})`);
      continue;
    }
    if (gated(raw)) throw new AppError("TikTok asked to log in or solve a challenge: open the socai Chrome window, log in with the watch account, then retry.", { code: "SHOP_LOGIN_REQUIRED", status: 409 });
    const cards = raw?.cards ?? raw?.profile?.video_cards ?? [];
    if (plan.mode === "creator" && raw?.profile) {
      store.upsertCreator({ handle: plan.query, displayName: raw.profile.display_name || null, followers: parseCount(raw.profile.followers) }, at);
      store.snapshot("creator", plan.query, date, { followers: parseCount(raw.profile.followers) });
    }
    for (const card of cards) if (/^https:\/\/www\.tiktok\.com\/@[\w.]+\/video\/\d+$/.test(card?.url || "") && !candidates.has(card.url)) candidates.set(card.url, { mode: plan.mode, query: plan.query });
    modes.push({ mode: plan.mode, query: plan.query, cards: cards.length });
  }

  const already = store.detailedSince(date);
  const todo = [...candidates.keys()].filter((url) => !already.has(url));
  const queue = todo.slice(0, cfg.dailyCap ?? 300);
  const skipped = todo.length - queue.length; // deferred by dailyCap, not the ones already detailed today
  const watched = new Set(cfg.creators ?? []);
  const videos = [];
  const products = new Map();
  const creators = new Set();
  const discovered = new Set();

  for (let i = 0; i < queue.length; i += BATCH) {
    if (i > 0) await sleep(3000 + Math.floor(random() * 6000));
    const batch = queue.slice(i, i + BATCH);
    let raw;
    try {
      raw = await runJson(["tiktok", "get-videos", ...batch.flatMap((url) => ["--video", url]), "--num-comments", "8", "--pretty"]);
      usage.details += 1;
    } catch (error) {
      errors.push(`get-videos batch ${i / BATCH + 1}: ${error.message}`);
      continue;
    }
    if (gated(raw)) throw new AppError("TikTok asked to log in or solve a challenge during video reads.", { code: "SHOP_LOGIN_REQUIRED", status: 409 });
    for (const item of raw?.videos ?? []) {
      if (!item?.ok || !item.entity?.url) { errors.push(`${item?.locator ?? "?"}: ${item?.error ?? item?.reason ?? "video_read_failed"}`); continue; }
      const meta = candidates.get(item.entity.url) ?? candidates.get(item.locator) ?? { mode: "unknown", query: "" };
      const row = videoRow(item.entity, meta);
      const tagged = shopAnchors(item.entity);
      for (const p of tagged) { store.upsertProduct(p, at); products.set(p.productId, p); }
      store.upsertVideo(row, tagged[0]?.productId ?? null, at);
      store.snapshot("video", row.url, date, row.stats);
      if (row.handle) {
        store.upsertCreator({ handle: row.handle, displayName: item.entity.author || null }, at);
        creators.add(row.handle);
        if (tagged.length && !watched.has(row.handle)) discovered.add(row.handle);
      }
      videos.push({ ...row, productIds: tagged.map((p) => p.productId), topComments: (item.entity.top_comments ?? []).slice(0, 8).map((c) => ({ text: c.text, likes: parseCount(c.likes) })) });
    }
  }

  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const file = path.join(outDir, `${date}.json`);
  const day = { runAt: at, date, niche, modes, videos, products: [...products.values()], creators: [...creators], discovered: [...discovered], errors, usage };
  await writeFile(file, JSON.stringify(day, null, 2), { mode: 0o600 });
  return { date, file, planned, cards: candidates.size, detailed: videos.length, products: products.size, creators: creators.size, discovered: [...discovered], errors, skipped };
}
```

(Keep the `import { parseCount }` from Task 1 at the top; move the new imports up with it.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test test/shop.test.js`
Expected: `# pass 8`

- [ ] **Step 6: Commit**

```bash
git add src/shop.js test/shop.test.js test/fixtures/shop/search.json test/fixtures/shop/author.json
git commit -m "feat(shop): collect watched searches into products, creators, videos and a day file"
```

---

### Task 4: Busy guard, CLI command, niche config

**Files:**
- Create: `src/shop-guard.js`, `niches/tiktok-shop-fr.json`
- Modify: `bin/jev-social.js` (help text near the `radar` line; new branch after the `radar` branch; flag lists in `parseArgs`)
- Modify: `package.json` (`check` script)
- Test: `test/shop-guard.test.js`

**Interfaces:**
- Produces: `socaiBusy({ runsDir, now?, pgrep?, maxAgeMin? }) → Promise<string|null>` (reason string when busy, `null` when free).
- Consumes: `collectShop`, `createShopStore`, `createSocaiRunJson({ config })`, `readConfig()`, `resolveSocaiBin(config, env)`, `runProcess(bin, args, { timeoutMs, env })`, `openDatabase(databasePath())`.

- [ ] **Step 1: Write the failing test** `test/shop-guard.test.js`:

```js
import assert from "node:assert/strict";
import { mkdir, mkdtemp, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { socaiBusy } from "../src/shop-guard.js";

const now = () => new Date("2026-10-07T07:30:00.000Z");

test("busy when a collection process runs", async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), "runs-"));
  assert.match(await socaiBusy({ runsDir, now, pgrep: async () => "123 socai tiktok search" }), /process/);
});

test("busy when a run directory is younger than 10 minutes, free otherwise", async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), "runs-"));
  const fresh = path.join(runsDir, "20261007_072500_tiktok_search");
  await mkdir(fresh);
  await utimes(fresh, new Date("2026-10-07T07:25:00.000Z"), new Date("2026-10-07T07:25:00.000Z"));
  assert.match(await socaiBusy({ runsDir, now, pgrep: async () => "" }), /run/);
  await utimes(fresh, new Date("2026-10-07T07:00:00.000Z"), new Date("2026-10-07T07:00:00.000Z"));
  assert.equal(await socaiBusy({ runsDir, now, pgrep: async () => "" }), null);
});

test("a missing runs directory counts as free", async () => {
  assert.equal(await socaiBusy({ runsDir: path.join(tmpdir(), "does-not-exist"), now, pgrep: async () => "" }), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/shop-guard.test.js`
Expected: FAIL, `Cannot find module '.../src/shop-guard.js'`

- [ ] **Step 3: Write `src/shop-guard.js`**

```js
import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// One socai Chrome for every session (GUIDE-LOCAL §2): refuse to collect while another collection runs or just ran.
// `shop` is left out on purpose: the launchd wrapper of this very run would match itself.
const PATTERN = String.raw`/socai(\.[^ ]+)? (tiktok|instagram|linkedin|x|xhs|dy) |jev-social\.js (discover|profile|media|search)`;

async function defaultPgrep() {
  try {
    const { stdout } = await promisify(execFile)("pgrep", ["-fl", PATTERN]);
    return stdout.split("\n").filter((line) => line && !line.startsWith(`${process.pid} `)).join("\n");
  } catch {
    return ""; // ponytail: pgrep exit 1 = no match; any other failure also means "cannot prove busy"
  }
}

export async function socaiBusy({ runsDir, now = () => new Date(), pgrep = defaultPgrep, maxAgeMin = 10 }) {
  const procs = await pgrep();
  if (procs.trim()) return `socai busy: collection process running (${procs.trim().split("\n")[0]})`;
  let names;
  try { names = await readdir(runsDir); } catch { return null; }
  const limit = now().getTime() - maxAgeMin * 60_000;
  for (const name of names) {
    const info = await stat(path.join(runsDir, name)).catch(() => null);
    if (info && info.mtimeMs > limit) return `socai busy: run ${name} is younger than ${maxAgeMin} min`;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/shop-guard.test.js`
Expected: `# pass 3`

- [ ] **Step 5: Write `niches/tiktok-shop-fr.json`**

```json
{
  "shop": {
    "global": ["tiktokshopfrance", "tiktokmademebuyit"],
    "tags": ["gadgetcuisine", "beaute", "maison"],
    "creators": [],
    "perQuery": 20,
    "dailyCap": 300
  }
}
```

- [ ] **Step 6: Wire the CLI in `bin/jev-social.js`**

Help text (next to the `radar` line):

```
  jev-social shop collect --niche <slug> [--dry-run]  TikTok Shop watch: searches, product anchors, day file, SQLite
```

Branch, placed right after the `radar` branch (same imports style, dynamic `import()`):

```js
  } else if (command === "shop") {
    const sub = rest[0];
    const flags = parseArgs(rest.slice(1));
    if (sub !== "collect") throw new AppError("Usage: jev-social shop collect --niche <slug> [--dry-run]", { code: "USAGE" });
    if (!flags.niche) throw new AppError("shop collect needs --niche <slug>.", { code: "USAGE" });
    const { databasePath, openDatabase } = await import("../src/profile/adapters/sqlite-repository.js");
    const { createShopStore } = await import("../src/shop-store.js");
    const { collectShop } = await import("../src/shop.js");
    const { socaiBusy } = await import("../src/shop-guard.js");
    const { runProcess } = await import("../src/process.js");
    const { resolveSocaiBin } = await import("../src/socai.js");
    const deck = JSON.parse(await readFile(new URL(`../niches/${flags.niche}.json`, import.meta.url), "utf8"));
    if (!deck.shop) throw new AppError(`niches/${flags.niche}.json has no "shop" key.`, { code: "USAGE" });
    const home = process.env.JEV_SOCIAL_HOME || path.join(os.homedir(), ".jev-social");
    const runsDir = path.join(process.env.SOCAI_HOME || path.join(os.homedir(), ".socai"), "runs");
    const busy = flags.dryRun ? null : await socaiBusy({ runsDir });
    if (busy) { console.error(busy + ", skipped."); process.exitCode = 0; return; }
    const config = await readConfig();
    const runJson = createSocaiRunJson({ config });
    const store = createShopStore(openDatabase(databasePath()));
    let result;
    try {
      result = await collectShop({ runJson, store, cfg: deck.shop, niche: flags.niche, outDir: path.join(home, "shop"), dryRun: Boolean(flags.dryRun), log: (line) => console.error(line) });
    } finally {
      if (!flags.dryRun) {
        const bin = await resolveSocaiBin(config, process.env);
        await runProcess(bin, ["stop"], { timeoutMs: 30_000, env: { ...process.env, SOCAI_TELEMETRY: "0", SOCAI_NO_UPDATE_CHECK: "1" } }).catch(() => {});
      }
    }
    if (flags.dryRun) { for (const q of result.planned) console.log(`${q.mode.padEnd(8)} ${q.query.padEnd(24)} socai ${q.args.join(" ")}`); return; }
    console.log(`shop ${result.date}: ${result.cards} cards, ${result.detailed} detailed, ${result.products} products, ${result.creators} creators, ${result.discovered.length} new sellers, ${result.errors.length} errors, ${result.skipped} left for tomorrow`);
    for (const error of result.errors) console.error(`  ! ${error}`);
    console.log(result.file);
  }
```

Check at the top of the file that `path`, `os` and `readFile` are imported (`import os from "node:os"` and `import { readFile } from "node:fs/promises"` if missing; `path` is already used). In `parseArgs`, add `["--dry-run", "dryRun"]` to the boolean flag list next to `["--no-jev", "noJev"]`.

- [ ] **Step 7: Add to `package.json` `check`**

Append ` && node --check ./src/shop.js && node --check ./src/shop-store.js && node --check ./src/shop-guard.js` to the `check` script.

- [ ] **Step 8: Verify**

Run: `npm run check && npm test`
Expected: check silent, all tests pass including `test/shop*.test.js`.

Run: `node bin/jev-social.js shop collect --niche tiktok-shop-fr --dry-run`
Expected: 5 lines (2 global, 3 tag), each ending with `socai tiktok search #<tag> --num 20 --pretty`.

- [ ] **Step 9: Commit**

```bash
git add src/shop-guard.js test/shop-guard.test.js niches/tiktok-shop-fr.json bin/jev-social.js package.json
git commit -m "feat(shop): shop collect command with busy guard and watch config"
```

---

### Task 5: First real run, launchd job, local guide

**Files:**
- Create: `scripts/launchd/com.mzane42.jev-shop-collect.plist`
- Modify: `docs/GUIDE-LOCAL.md` (new section "8 octies. Veille TikTok Shop"; file is local and untracked, no commit)

- [ ] **Step 1: Real run by hand** (watch account logged in, no other collection running)

Run: `node bin/jev-social.js shop collect --niche tiktok-shop-fr`
Expected: one summary line, `~/.jev-social/shop/<today>.json` written, then:

```bash
sqlite3 ~/.jev-social/jev-social.db "select count(*) from shop_videos where product_id is not null; select title from shop_products limit 5;"
```

Expected: count > 0 and 5 French product titles. If count is 0, open the day file and check `videos[].isEc` (true means the anchor loads client side; the video still counts) before touching code.

- [ ] **Step 2: Write the plist** `scripts/launchd/com.mzane42.jev-shop-collect.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mzane42.jev-shop-collect</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>cd /Users/bubblz/cinema/jev-social && node bin/jev-social.js shop collect --niche tiktok-shop-fr</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/Users/bubblz/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>/Users/bubblz/Library/Logs/jev-shop-collect.log</string>
  <key>StandardErrorPath</key><string>/Users/bubblz/Library/Logs/jev-shop-collect.log</string>
</dict>
</plist>
```

Install and test:

```bash
cp scripts/launchd/com.mzane42.jev-shop-collect.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mzane42.jev-shop-collect.plist
launchctl kickstart -k gui/$(id -u)/com.mzane42.jev-shop-collect
tail -f ~/Library/Logs/jev-shop-collect.log
```

Expected in the log: either `socai busy: … skipped.` (if the hand run was under 10 minutes ago) or the summary line. Disable with `launchctl bootout gui/$(id -u)/com.mzane42.jev-shop-collect`.

- [ ] **Step 3: GUIDE-LOCAL section** (French, after "8 septies"):

```markdown
## 8 octies. Veille TikTok Shop (7 oct. 2026)

- Config : `niches/tiktok-shop-fr.json`, clé `shop` (`global`, `tags`, `creators`, `perQuery`, `dailyCap`). Ajouter un `@handle` dans `creators` pour le suivre ; `discovered` du fichier du jour liste les vendeurs vus mais non suivis.
- Collecte : `node bin/jev-social.js shop collect --niche tiktok-shop-fr [--dry-run]`. Garde-fou : saute si une collecte socai tourne ou a tourné il y a moins de 10 min. Termine par `socai stop`.
- Sortie : `~/.jev-social/shop/AAAA-MM-JJ.json` + tables `shop_products`, `shop_creators`, `shop_videos`, `shop_snapshots` dans `~/.jev-social/jev-social.db`.
- Produit tagué = ancre `anchor_shop` dans `entity.anchors` (binaire `socai.0.6.5-anchors`). Pas de prix ni de ventes dans cette ancre ; `is_ec_video = 1` marque une vidéo qui vend même sans ancre.
- Tâche launchd `com.mzane42.jev-shop-collect`, 7 h 30, log `~/Library/Logs/jev-shop-collect.log`.
- Suite : scoring Jev (sous-projet 2), tendances (3), brief (4), ventes propres (5).
```

- [ ] **Step 4: Commit the plist**

```bash
git add scripts/launchd/com.mzane42.jev-shop-collect.plist
git commit -m "chore(shop): launchd template for the daily TikTok Shop collection"
```

---

## Self-review notes

- Spec coverage: three modes (Task 3 `planQueries`), dedupe per day and cap (Task 3), pauses (Task 3 `sleep`), anchors → products/creators/videos (Tasks 1-3), `discovered` (Task 3), day file shape (Task 3), SQLite tables (Task 2), busy guard + `socai stop` (Task 4), gate abort (Task 3), launchd (Task 5), big-int ids (Task 1). Product snapshots (`sold_text`, `price`) stay empty until 1b; the columns exist.
- `shop_videos.detailed_at` doubles as "detailed today" marker; `first_seen` is kept by the upsert.
- Not built on purpose: product-level daily snapshots (derivable from video snapshots in sub-project 3), transcripts (sub-project 2), Telegram (sub-project 4).
