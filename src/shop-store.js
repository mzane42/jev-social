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
  // Product videos not read today, newest views first: re-read daily so snapshots give a day-over-day delta.
  const refreshable = db.prepare(`SELECT v.url, v.mode, v.query FROM shop_videos v
    LEFT JOIN shop_snapshots s ON s.kind = 'video' AND s.id = v.url
      AND s.date = (SELECT MAX(date) FROM shop_snapshots WHERE kind = 'video' AND id = v.url)
    WHERE v.product_id IS NOT NULL AND v.detailed_at < ? AND v.first_seen >= ?
    ORDER BY COALESCE(s.views, 0) DESC LIMIT ?`);
  const counts = {
    videos: db.prepare("SELECT COUNT(*) AS n FROM shop_videos WHERE detailed_at >= ?"),
    products: db.prepare("SELECT COUNT(*) AS n FROM shop_products WHERE last_seen >= ?"),
    creators: db.prepare("SELECT COUNT(*) AS n FROM shop_creators WHERE last_seen >= ?"),
  };
  const n = (v) => (v == null ? null : v);
  return {
    db,
    upsertProduct: (p, at) => product.run(p.productId, p.title, p.shortTitle, p.url, p.sellerId, JSON.stringify(p.categories ?? []), p.skuCount ?? null, p.coverUrl, p.source, at, at),
    upsertCreator: (c, at) => creator.run(c.handle, c.displayName ?? null, n(c.followers), at, at),
    upsertVideo: (row, productId, at) => video.run(row.url, row.videoId, row.handle, productId, row.isEc ? 1 : 0, row.caption, row.createdAt, row.duration, row.mode, row.query, at, at),
    snapshot: (kind, id, date, s = {}) => snap.run(date, kind, id, n(s.views), n(s.likes), n(s.comments), n(s.shares), n(s.saves), n(s.followers), s.soldText ?? null, s.price ?? null),
    detailedSince: (date) => new Set(detailed.all(date).map((r) => r.url)),
    refreshable: (date, { since, limit }) => refreshable.all(date, since, limit),
    counts: (date) => Object.fromEntries(Object.entries(counts).map(([k, q]) => [k, q.get(date).n])),
  };
}
