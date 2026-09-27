const ALLOWED_HOSTS = ["tiktok.com", "instagram.com"];

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function safeHref(url) {
  try {
    const parsed = new URL(url);
    const ok = parsed.protocol === "https:" && ALLOWED_HOSTS.some((host) => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
    return ok ? parsed.href : null;
  } catch {
    return null;
  }
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const num = (value) => (value == null ? "n/a" : compact.format(value));
const pct = (value) => (value == null ? "n/a" : `${(value * 100).toFixed(1)}%`);
const ratio = (value) => (value == null ? "n/a" : `${value.toFixed(2)}×`);
const link = (url, label) => {
  const href = safeHref(url);
  return href ? `<a href="${escapeHtml(href)}" rel="noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label);
};

const STYLE = `
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#78716c;--card:#fff;--line:#e7e5e4;--accent:#e11d48;--warn:#b45309}
@media (prefers-color-scheme: dark){:root{--bg:#0c0a09;--fg:#f5f5f4;--muted:#a8a29e;--card:#1c1917;--line:#292524;--accent:#fb7185;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:1040px;margin:0 auto;padding:24px 16px}h1{margin:0 0 4px;font-size:1.6rem}h2{margin:32px 0 12px;font-size:1.1rem}
a{color:var(--accent)}.muted{color:var(--muted)}.banner{border:1px solid var(--warn);color:var(--warn);padding:8px 12px;border-radius:8px;margin:16px 0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.card b{display:block;font-size:1.4rem}.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}th{cursor:pointer;white-space:nowrap}
td.n{text-align:right;font-variant-numeric:tabular-nums}svg{width:100%;height:auto}svg rect{fill:var(--accent)}svg text{fill:var(--muted);font-size:10px}
ul{padding-left:18px}li{margin:6px 0}`;

const SORT_SCRIPT = `document.querySelectorAll("table[data-sort] th").forEach((th,i)=>th.addEventListener("click",()=>{const t=th.closest("table"),b=t.tBodies[0],d=th.dataset.dir==="asc"?"desc":"asc";th.dataset.dir=d;const v=r=>{const c=r.cells[i];return c.dataset.v!==undefined?Number(c.dataset.v):c.textContent};[...b.rows].sort((x,y)=>{const a=v(x),c=v(y);return (a>c?1:a<c?-1:0)*(d==="asc"?1:-1)}).forEach(r=>b.append(r))}))`;

function page(title, body, { sortable = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main>${sortable ? `<script>${SORT_SCRIPT}</script>` : ""}</body></html>\n`;
}

function numCell(value, format) {
  return `<td class="n" data-v="${value == null ? -1 : value}">${format(value)}</td>`;
}

function viewsChart(items) {
  const viewed = items.filter((item) => item.views != null);
  if (!viewed.length) return `<p class="muted">No view counts captured (n/a).</p>`;
  const max = Math.max(...viewed.map((item) => item.views)) || 1;
  const bar = 28;
  const gap = 8;
  const width = viewed.length * (bar + gap);
  const bars = viewed.map((item, index) => {
    const height = Math.max(2, Math.round((item.views / max) * 140));
    const x = index * (bar + gap);
    return `<rect x="${x}" y="${150 - height}" width="${bar}" height="${height}" rx="3"><title>${escapeHtml(num(item.views))} views</title></rect><text x="${x + bar / 2}" y="164" text-anchor="middle">${index + 1}</text>`;
  }).join("");
  return `<svg viewBox="0 0 ${width} 170" role="img" aria-label="Views per item">${bars}</svg>`;
}

export function renderReport({ snapshot, metrics, insights = [], insightNotice = null, version }) {
  const { profile } = snapshot;
  const rates = new Map(metrics.items.map((entry) => [entry.url, entry]));
  const name = profile.displayName || `@${snapshot.handle}`;
  const rows = snapshot.items.map((item, index) => {
    const rate = rates.get(item.url) || {};
    return `<tr><td class="n" data-v="${index + 1}">${index + 1}</td><td>${link(item.url, (item.caption || item.url).slice(0, 90))}</td>${numCell(item.views, num)}${numCell(item.likes, num)}${numCell(item.shares, num)}${numCell(item.saves, num)}${numCell(item.comments, num)}${numCell(rate.likeRate, pct)}${numCell(rate.shareRate, pct)}<td>${escapeHtml(item.createdAt ? item.createdAt.slice(0, 10) : "n/a")}</td></tr>`;
  }).join("");
  const comments = snapshot.items.flatMap((item) => item.topComments.map((entry) => ({ ...entry, url: item.url })))
    .sort((a, b) => (b.likes ?? -1) - (a.likes ?? -1)).slice(0, 12)
    .map((entry) => `<li>${escapeHtml(entry.text)} <span class="muted">(${num(entry.likes)} likes · ${link(entry.url, "source")})</span></li>`).join("");
  const insightHtml = insights.length
    ? `<ul>${insights.map((entry) => `<li><b>${escapeHtml(entry.title)}</b>: ${escapeHtml(entry.body)} <span class="muted">${entry.sources.map((source, index) => link(source, `[${index + 1}]`)).join(" ")}</span></li>`).join("")}</ul>`
    : `<p class="muted">${escapeHtml(insightNotice || "No insights.")}</p>`;
  const body = `
<h1>${escapeHtml(name)}</h1>
<p class="muted">${link(snapshot.url, `${snapshot.platform} @${snapshot.handle}`)} · niche ${escapeHtml(snapshot.niche)} · captured ${escapeHtml(snapshot.capturedAt)}</p>
${profile.bio ? `<p>${escapeHtml(profile.bio)}</p>` : ""}
${snapshot.partial ? `<div class="banner">Partial capture: ${escapeHtml(snapshot.partialReason)}</div>` : ""}
<div class="cards">
<div class="card"><span class="muted">Followers</span><b>${num(profile.followers)}</b></div>
<div class="card"><span class="muted">Median views</span><b>${num(metrics.medianViews)}</b></div>
<div class="card"><span class="muted">Views / follower</span><b>${ratio(metrics.viewsPerFollower)}</b></div>
<div class="card"><span class="muted">Outliers (&gt;3× median)</span><b>${metrics.outliers.length}</b></div>
<div class="card"><span class="muted">Posts / week</span><b>${metrics.postsPerWeek == null ? "n/a" : metrics.postsPerWeek.toFixed(1)}</b></div>
<div class="card"><span class="muted">Best item</span><b>${metrics.bestItemUrl ? link(metrics.bestItemUrl, "open") : "n/a"}</b></div>
</div>
<h2>Insights</h2>${insightHtml}
<h2>Views per item</h2>${viewsChart(snapshot.items)}
<h2>Items</h2><div class="scroll"><table data-sort><thead><tr><th>#</th><th>Caption</th><th>Views</th><th>Likes</th><th>Shares</th><th>Saves</th><th>Comments</th><th>Like rate</th><th>Share rate</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2>Top comments</h2>${comments ? `<ul>${comments}</ul>` : `<p class="muted">No comments captured.</p>`}
<p class="muted">jev-social ${escapeHtml(version)} · data.json alongside this file</p>`;
  return page(`${name} report`, body, { sortable: true });
}

export function renderNicheIndex(niche, entries) {
  const rows = entries.map(({ href, snapshot, metrics }) => `<tr><td><a href="${escapeHtml(href)}">${escapeHtml(`${snapshot.platform} @${snapshot.handle}`)}</a></td>${numCell(snapshot.profile.followers, num)}${numCell(metrics.medianViews, num)}${numCell(metrics.viewsPerFollower, ratio)}${numCell(metrics.outliers.length, String)}<td>${escapeHtml(snapshot.capturedAt.slice(0, 10))}${snapshot.partial ? " (partial)" : ""}</td></tr>`).join("");
  return page(`${niche} niche`, `<h1>${escapeHtml(niche)}</h1><p><a href="../index.html">All niches</a></p><div class="scroll"><table data-sort><thead><tr><th>Account</th><th>Followers</th><th>Median views</th><th>Views / follower</th><th>Outliers</th><th>Captured</th></tr></thead><tbody>${rows}</tbody></table></div>`, { sortable: true });
}

export function renderRootIndex(niches) {
  const rows = niches.map((entry) => `<tr><td><a href="${escapeHtml(`${entry.niche}/index.html`)}">${escapeHtml(entry.niche)}</a></td><td class="n">${entry.accounts}</td><td>${escapeHtml(entry.updatedAt.slice(0, 10))}</td></tr>`).join("");
  return page("Niche reports", `<h1>Niche reports</h1><div class="scroll"><table><thead><tr><th>Niche</th><th>Accounts</th><th>Last update</th></tr></thead><tbody>${rows}</tbody></table></div>`);
}
