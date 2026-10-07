# TikTok Shop watch, sub-project 1: collection — design

Goal: once a day, collect the TikTok videos that sell a product, with the
product and the creator linked, for three watch modes (global, tag, creator),
into one JSON file per day and SQLite tables. Later sub-projects score
(Jev), compute trends, write the morning brief and import own sales.

Parent plan: `~/.claude/plans/pasted-content-id-d070-roadmap-streamed-moler.md`
(decomposition of the 6 Oct 2026 roadmap).

## Known live state (7 Oct 2026)

- Active binary: official socai 0.6.5 (`~/.socai/bin/socai`). The fork
  `/Users/bubblz/cinema/socai` builds with `~/.cargo/bin/cargo`; its
  `scripts/local-update.sh` is deprecated.
- socai `tiktok get-videos` returns no product / anchor field
  (`core/src/sites/tiktok/entities.rs` `TikTokVideo`). TikTok's page JSON
  `__UNIVERSAL_DATA_FOR_REHYDRATION__ → webapp.video-detail.itemInfo.itemStruct`
  is already read in `page_scripts.js` `initialVideo()`; whether it carries
  `anchors` for FR product videos is the spike question.
- No scheduling, lock, rate limit, Claude call or brief generator in the repo.

## Spike S0 — result (7 Oct 2026, run `20261007_001915_tiktok_get-videos`)

Stock 0.6.5, `tiktok get-videos --debug-snapshot` on 4 product videos from
`tiktok search "#tiktokshopfrance"` plus 1 control, logged-in watch account,
region FR, desktop web.

| field | where | present |
|---|---|---|
| `isECVideo = 1` | `itemStruct.isECVideo` | 4/4 product videos, absent on control |
| shop anchor | `itemStruct.anchors[i]` with `type 35`, whose `extra` is a JSON **string** → array of `{type: 33, component_key: "anchor_shop", id, keyword, extra}` | 2/4 |
| product fields | inner `extra` (JSON string again): `product_id, title, elastic_title, cover_url, img_url[], seller_id, source ("TikTok Shop"), categories[3]{category_id, category_name (FR), level}, skus[]{sku_id}, currency, price (0), market_price (0), detail_url (oec-api), product_status, in_shop` | 2/4 |
| CapCut anchor | `anchors[]` `type 54` / `type 35` without shop payload | noise, skip |
| shop card in DOM / a11y | none: desktop web does not render the product card | 0/4 |

Findings:
- Product identity, title, seller and category come for free from the SSR
  JSON when the anchor is present. **Price and sold count are not there**
  (`price = 0`). They need the product page (1b).
- Two of four product videos (`isECVideo = 1`) had no shop anchor in SSR;
  the anchor is probably loaded client side. Store `isECVideo` so those
  videos still count as "sells something", product unknown.
- `product_id`, `seller_id`, `sku_id` exceed 2^53. `JSON.parse` on the
  inner string silently rounds them (`…546100068` → `…546100000`). Quote
  15+ digit integers with a regex before parsing, keep ids as strings.
- `anchors` is dropped by socai today: the fork patch is one field.

Decision: 1a goes ahead (`anchors` + `isECVideo` kept raw).

Product page check: anonymous fetch of `tiktok.com/view/product/<id>`
returns a "Security Check" captcha page; socai rejects a product URL in
`get-videos` before navigating, and `page_state` takes no URL. So the check
can only run inside the 1b tool itself. 1b is deferred: its first task is
the tool skeleton that navigates to the product URL in the managed Chrome
and records a snapshot; price and sold count are added only if that page
renders them for the logged-in watch account. Until then, trends use views,
video counts and creator counts.

## 1a. socai fork patch (branch `feat/tiktok-anchors`)

- `page_scripts.js` `videoDetail()`: `anchors: stateVideo.anchors || []`,
  `is_ec_video: Number(stateVideo.isECVideo || 0)`.
- `entities.rs` `TikTokVideo`: `pub anchors: Vec<Value>`, `pub is_ec_video: i64`.
- Build `cargo build --release -q -p socai-cli`, install as
  `~/.socai/bin/socai.0.6.5-anchors`, point `~/.jev-social/config.json`
  `socaiBin` at it. Official binary untouched. Upstream PR with the field.

## 1b. `socai tiktok product <url>` (only if S0 says readable)

`ProductTool` beside `PageStateTool` (`tools.rs`), page script `productDetail()`.
Fields: `product_id, name, price, currency, sold_count_text, rating,
review_count, shop_name, shop_url, url`. Read-only.

## 1c. jev-social collector

### Input

`niches/tiktok-shop-fr.json`, a `shop` key read like `radar`:

```json
{ "shop": {
    "global": ["tiktokshopfrance", "tiktokmademebuyit"],
    "tags": ["gadgetcuisine", "beaute", "maison"],
    "creators": [],
    "perQuery": 20, "dailyCap": 300 } }
```

### Flow

`jev-social shop collect --niche tiktok-shop-fr [--dry-run]`

1. Busy guard (from `socai/scripts/local-update.sh:35-41`): skip with
   "socai busy" if a socai/jev-social collection process exists or any
   `~/.socai/runs/*` was modified in the last 10 min.
2. Global + tags → `tiktok search <#tag> --num perQuery`; creators →
   `tiktok author <url> --num perQuery`. Through `runSocaiJson`.
3. Cards not detailed today, up to `dailyCap` → `tiktok get-videos --video
   <url> --num-comments 8` → `entity.anchors`. Random 3 to 9 s pause between
   calls. No anchor → stored with `product_id = NULL`, never re-detailed.
4. Anchors → `shop_products`; `shop_videos.product_id`; `shop_creators` from
   `author_id`. Unknown creator with a product → `discovered[]` in the day
   file (promoted to `creators[]` by hand).
5. Write `~/.jev-social/shop/YYYY-MM-DD.json`
   `{ runAt, modes, videos, products, creators, discovered, errors, usage }`,
   upsert SQLite, then `socai stop`.

### Store (`src/shop-store.js`, lazy `CREATE TABLE IF NOT EXISTS`, same DB)

| table | key | columns |
|---|---|---|
| `shop_products` | `product_id` | `name, url, shop_name, first_seen, last_seen, raw` |
| `shop_creators` | `handle` | `followers, display_name, first_seen, last_seen, watched` |
| `shop_videos` | `url` | `video_id, handle, product_id, caption, created_at, duration, mode, query, first_seen, jev` |
| `shop_snapshots` | `(date, kind, id)` | `views, likes, comments, shares, saves, followers, sold_text, price` |

### Files

`src/shop.js` (collect), `src/shop-store.js` (tables, upserts, later trend
queries), `niches/tiktok-shop-fr.json`, `bin/jev-social.js` (`shop` branch,
`--dry-run`), `package.json` `check` script, `test/shop*.test.js` with
fixtures in `test/fixtures/shop/` (anonymised anchor from S0),
`~/Library/LaunchAgents/com.mzane42.jev-shop-collect.plist` (daily 07:30,
explicit `PATH`, log `~/Library/Logs/jev-shop-collect.log`).

## Errors

Failed search or video → entry in `errors[]`, run continues. Login gate or
captcha (`src/evidence.js` gate regex) → abort early, one clear stderr line.
socai timeout → `runSocaiJson` default 8 min, counted as an error.

## Boundaries

- Read-only. Never `--transcribe-audio`. `--download-media` never from this
  command (transcripts come later via the `media` path on a top-10 only).
- Telemetry env forced on every spawn, managed Chrome profile, watch account
  only, never the affiliate account.
- One socai Chrome shared by all sessions: the busy guard is mandatory.
- Sold counts are rounded on TikTok; store the text, compare deltas only.

## Out of scope (later sub-projects)

Jev questions and Claude escalation (2), trend queries and dashboard page
(3), brief and Telegram (4), Creator Center import (5).
