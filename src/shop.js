import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors.js";
import { parseCount } from "./profile/domain.js";

// TikTok Shop watch: search/author cards → get-videos details → anchors → products, creators, videos.
// Config: `shop` key of niches/<niche>.json ({ global, tags, creators, perQuery, dailyCap }).

const BIG_INT = /("(?:product_id|seller_id|sku_id|id)"\s*:\s*)(\d{15,})/g;
const VIDEO_URL = /^https:\/\/www\.tiktok\.com\/@[\w.]+\/video\/\d+$/;
const BATCH = 5;
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
const gate = (where) => new AppError(`TikTok asked to log in or solve a challenge ${where}: open the socai Chrome window, log in with the watch account, then retry.`, { code: "SHOP_LOGIN_REQUIRED", status: 409 });

export async function collectShop({ runJson, store, cfg, niche, outDir, now = () => new Date(), sleep = defaultSleep, random = Math.random, log = () => {}, dryRun = false }) {
  const planned = planQueries(cfg);
  if (dryRun) return { date: null, file: null, planned, cards: 0, detailed: 0, products: 0, creators: 0, discovered: [], errors: [], skipped: 0 };

  const at = now().toISOString();
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
    if (gated(raw)) throw gate(`on ${plan.mode} ${plan.query}`);
    const cards = raw?.cards ?? raw?.profile?.video_cards ?? [];
    if (plan.mode === "creator" && raw?.profile) {
      const followers = parseCount(raw.profile.followers);
      store.upsertCreator({ handle: plan.query, displayName: raw.profile.display_name || null, followers }, at);
      store.snapshot("creator", plan.query, date, { followers });
    }
    for (const card of cards) if (VIDEO_URL.test(card?.url || "") && !candidates.has(card.url)) candidates.set(card.url, { mode: plan.mode, query: plan.query });
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
    if (gated(raw)) throw gate("during video reads");
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
