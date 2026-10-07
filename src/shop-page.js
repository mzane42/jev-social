import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// ponytail: server-rendered table of the latest shop day file; dashboard /api/shop comes with sub-project 3.

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (v) => (v == null ? "" : Number(v).toLocaleString("fr-FR"));
const link = (href, text) => `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(text)}</a>`;

/** Latest `<YYYY-MM-DD>.json` in the shop dir, or null. */
export async function readLatestShopDay(shopDir) {
  let names;
  try { names = await readdir(shopDir); } catch { return null; }
  const latest = names.filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().at(-1);
  return latest ? JSON.parse(await readFile(path.join(shopDir, latest), "utf8")) : null;
}

export function renderShopPage(day) {
  if (!day) return `<!doctype html><meta charset="utf-8"><title>TikTok Shop</title><p>Aucune collecte. Lance <code>jev-social shop collect --niche tiktok-shop-fr</code>.</p>`;
  const products = new Map((day.products ?? []).map((p) => [p.productId, p]));
  const videos = [...(day.videos ?? [])].sort((a, b) => (b.stats?.views ?? 0) - (a.stats?.views ?? 0));
  const productRows = (day.products ?? []).map((p) => `<tr>
    <td>${p.coverUrl ? `<img src="${esc(p.coverUrl)}" alt="" width="56" loading="lazy">` : ""}</td>
    <td>${link(p.url, p.title)}</td><td>${esc((p.categories ?? []).join(" › "))}</td><td>${num(p.skuCount)}</td><td>${esc(p.sellerId)}</td></tr>`).join("");
  const videoRows = videos.map((v) => `<tr>
    <td>${num(v.stats?.views)}</td><td>${num(v.stats?.likes)}</td><td>${num(v.stats?.saves)}</td>
    <td>${link(v.url, "@" + v.handle)}</td><td>${v.isEc ? "✓" : ""}</td>
    <td>${(v.productIds ?? []).map((id) => esc(products.get(id)?.shortTitle || products.get(id)?.title || id)).join("<br>")}</td>
    <td>${esc(v.mode)} ${esc(v.query)}</td><td title="${esc(v.caption)}">${esc(String(v.caption ?? "").slice(0, 90))}</td></tr>`).join("");
  return `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TikTok Shop ${esc(day.date)}</title>
<style>body{font:14px system-ui;margin:16px;background:#fff;color:#111}table{border-collapse:collapse;width:100%;margin:8px 0 24px}th,td{border-bottom:1px solid #ddd;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f4f4f4}td:first-child{white-space:nowrap}img{border-radius:4px}</style>
<h1>TikTok Shop · ${esc(day.niche)} · ${esc(day.date)}</h1>
<p>${num(Array.isArray(day.modes) ? day.modes.length : day.modes)} requêtes · ${num(day.videos?.length)} vidéos · ${num(day.products?.length)} produits · ${num(day.creators?.length)} créateurs · ${num(day.discovered?.length)} nouveaux vendeurs · ${num(day.errors?.length)} erreurs · collecte ${esc(day.runAt)}</p>
<h2>Produits</h2><table><tr><th></th><th>Produit</th><th>Catégories</th><th>SKU</th><th>Vendeur</th></tr>${productRows}</table>
<h2>Vidéos</h2><table><tr><th>Vues</th><th>Likes</th><th>Saves</th><th>Compte</th><th>Shop</th><th>Produit</th><th>Requête</th><th>Légende</th></tr>${videoRows}</table></html>`;
}
