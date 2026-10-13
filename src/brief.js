// Morning brief: what the world is talking about today, in one markdown page, for the episode BRIEF loop.
// Free public sources (no key) + radar_items + the user's manual IG notes; optional TikTok check through socai.
// Attention signals only: a virality number in a BRIEF must still cite a jev-social report (n, lift), GUIDE-LOCAL.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fold, parseRss } from "./radar.js";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/126 Safari/537.36";
const ymd = (d) => d.toISOString().slice(0, 10);
const parisDay = (d) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

// Reddit serves Atom (<entry>, <link href>), not RSS.
export function parseAtom(xml) {
  const decode = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, e]) => ({
    title: decode(e.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "").trim(), link: e.match(/<link href="([^"]+)"/)?.[1] ?? "",
  })).filter((i) => i.title);
}

export function parseTrends24(html, max = 10) {
  return [...html.matchAll(/class=trend-link>([^<]+)</g)].map((m) => m[1].trim()).filter((t, i, a) => a.indexOf(t) === i).slice(0, max);
}

export function parseNetflixTop10(tsv, max = 5) {
  const rows = tsv.trim().split("\n").map((l) => l.split("\t"));
  const week = rows[1]?.[0];
  return rows.slice(1).filter((r) => r[0] === week && Number(r[2]) <= max)
    .map((r) => ({ week, category: r[1], rank: Number(r[2]), title: r[3], season: r[4] === "N/A" ? "" : r[4] }));
}

export function parseEspnEvents(json, league) {
  return (json.events ?? []).map((e) => ({ date: e.date, name: e.name, league }));
}

// A topic touches the cast when one cast name appears in it (accents folded).
export const castHits = (text, cast) => cast.filter((c) => fold(text).includes(fold(c)));

const WIKI_NOISE = /^(Wikip[ée]dia|Spécial|Special|Cookie|Fichier|File):|^Main_Page$|_\(informatique\)$/;

async function get(fetchImpl, url, kind = "text", headers = {}) {
  try {
    const res = await fetchImpl(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return kind === "json" ? await res.json() : await res.text();
  } catch {
    return null;
  }
}

export async function collectBrief({ db, deck, cast = [], fetchImpl = fetch, now = new Date(), log = () => {} }) {
  const cfg = deck.brief ?? {};
  const out = { date: parisDay(now), matches: [], radar: [], google: [], x: {}, reddit: [], wiki: {}, netflix: [], hashtags: [], missing: [] };

  // 1. Big matches, next 7 days (ESPN accepts one day per call).
  for (const league of cfg.leagues ?? ["uefa.champions", "eng.1", "esp.1", "fra.1"]) {
    for (let d = 0; d < 7; d++) {
      const day = ymd(new Date(now.getTime() + d * 86_400_000)).replaceAll("-", "");
      const json = await get(fetchImpl, `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${day}`, "json");
      if (json) out.matches.push(...parseEspnEvents(json, league));
    }
  }
  const watch = cfg.watchClubs ?? [];
  const started = new Date(now.getTime() - 2 * 3_600_000).toISOString();
  out.matches = out.matches.filter((m) => m.date >= started).filter((m) => !watch.length || watch.some((c) => fold(m.name).includes(fold(c))))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!out.matches.length) out.missing.push("ESPN");

  // 2. Radar stories (last 72 h): Jev priority when scored, freshness otherwise.
  if (db) {
    const since = new Date(now.getTime() - 72 * 3_600_000).toISOString();
    out.radar = db.prepare(`SELECT title, link, source, published_at, cast_names, score FROM radar_items
      WHERE published_at >= ? AND cast_names != '[]' ORDER BY score IS NULL, score DESC, published_at DESC LIMIT 12`).all(since);
  }

  // 3. Search and social trends.
  const g = await get(fetchImpl, `https://trends.google.com/trending/rss?geo=${cfg.trendsGeo ?? "FR"}`);
  out.google = g ? parseRss(g, "Google Trends").map((i) => i.title).slice(0, 15) : (out.missing.push("Google Trends"), []);
  for (const country of cfg.xCountries ?? ["france", "united-kingdom", "spain"]) {
    const html = await get(fetchImpl, `https://trends24.in/${country}/`);
    if (html) out.x[country] = parseTrends24(html);
    else out.missing.push(`X ${country}`);
  }
  const r = await get(fetchImpl, "https://www.reddit.com/r/soccer/top.rss?t=day", "text", { "user-agent": "jev-social-brief/0.1" });
  out.reddit = r ? parseAtom(r).slice(0, 10) : (out.missing.push("Reddit"), []);

  // 4. Culture peaks for crossovers: Wikipedia (J-2 is the latest complete day) + Netflix weekly top 10.
  const wikiDay = new Date(now.getTime() - 2 * 86_400_000);
  for (const lang of cfg.wiki ?? ["fr", "en"]) {
    const json = await get(fetchImpl, `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia/all-access/${ymd(wikiDay).replaceAll("-", "/")}`, "json");
    out.wiki[lang] = json ? json.items[0].articles.map((a) => a.article).filter((a) => !WIKI_NOISE.test(a)).slice(0, 15).map((a) => a.replaceAll("_", " ")) : [];
  }
  const tsv = await get(fetchImpl, "https://www.netflix.com/tudum/top10/data/all-weeks-global.tsv", "text", { "user-agent": "curl/8" });
  out.netflix = tsv ? parseNetflixTop10(tsv, 3) : (out.missing.push("Netflix"), []);

  // 5. Hashtags in captions of the niche's reports, last 30 days (counts, not lift).
  if (db) {
    const rows = db.prepare(`SELECT data FROM reports WHERE niche = ? AND date >= ?`).all(deck.niche, ymd(new Date(now.getTime() - 30 * 86_400_000)));
    const counts = new Map();
    for (const { data } of rows) {
      for (const item of JSON.parse(data)?.snapshot?.items ?? []) {
        for (const tag of new Set(String(item.caption ?? "").toLowerCase().match(/#[\p{L}\p{N}_]+/gu) ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    out.hashtags = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 15);
    out.hashtagReports = rows.length;
  }
  out.castInTrends = [...new Set([...out.google, ...Object.values(out.x).flat(), ...out.reddit.map((i) => i.title)].flatMap((t) => castHits(t, cast)))];
  log(`brief: ${out.matches.length} matches, ${out.radar.length} radar, missing: ${out.missing.join(", ") || "none"}`);
  return out;
}

// TikTok check through socai: one browser, one collection at a time, telemetry off, stop at the end (GUIDE-LOCAL §2).
export async function socialCheck({ queries, num = 8, search, stop, busy = async () => null, now = Date.now(), log = () => {} }) {
  const recent = await busy();
  if (recent) {
    log(`social: skipped, ${recent} (one collection at a time)`);
    return { skipped: recent, results: [] };
  }
  const results = [];
  try {
    for (const query of queries) {
      try {
        const res = await search(query, num);
        const cards = (res?.data?.cards ?? res?.cards ?? []).map((v) => ({
          url: v.url, views: parseCount(v.views), caption: String(v.title ?? "").replace(/\s+/g, " ").slice(0, 90), author: v.author ?? "", days: ageDays(v.video_id, now),
        })).sort((a, b) => b.views - a.views || (a.days ?? 99) - (b.days ?? 99));
        results.push({ query, cards });
      } catch (error) {
        results.push({ query, error: String(error?.message ?? error).slice(0, 120), cards: [] });
      }
    }
  } finally {
    await stop();
  }
  return { results };
}

// TikTok shows "127.3K" / "1.2M"; the video id carries its upload time in its top 32 bits.
export function parseCount(text) {
  const m = String(text ?? "").replace(",", ".").match(/([\d.]+)\s*([KMB])?/i);
  return m ? Math.round(Number(m[1]) * ({ K: 1e3, M: 1e6, B: 1e9 }[m[2]?.toUpperCase()] ?? 1)) : 0;
}

export function ageDays(videoId, now = Date.now()) {
  try {
    return Math.floor((now / 1000 - Number(BigInt(videoId) >> 32n)) / 86_400);
  } catch {
    return null;
  }
}

const list = (items) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- (rien)");

export function renderBrief(b, { igNotes = "", social = null } = {}) {
  const fr = (iso) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const parts = [
    `# Veille actu — ${b.date}`,
    `Signaux d'attention, pas de viralité. Un chiffre de viralité dans un BRIEF cite un rapport jev-social (n, lift) ; rien sous n = 8 n'est une règle.${b.missing.length ? `\nSources muettes ce matin : ${b.missing.join(", ")}.` : ""}`,
    `## Casting dans les tendances\n${list(b.castInTrends)}`,
    `## Gros matchs, 7 jours\n${list(b.matches.map((m) => `${fr(m.date)} · ${m.name} (${m.league})`))}`,
    `## Radar actu (72 h, casting concerné)\n${list(b.radar.map((i) => `${i.score == null ? "·" : Math.round(i.score)} [${i.title}](${i.link}) — ${JSON.parse(i.cast_names).join(", ")}`))}`,
    `## Ce que la France cherche (Google)\n${b.google.join(" · ") || "(rien)"}`,
    `## X (Twitter), tendances par pays\n${Object.entries(b.x).map(([c, t]) => `- **${c}** : ${t.join(" · ")}`).join("\n") || "- (rien)"}`,
    `## r/soccer, top du jour\n${list(b.reddit.map((i) => `[${i.title.slice(0, 140)}](${i.link})`))}`,
    `## Pics culture pour crossovers (Wikipedia J-2, Netflix semaine)\n- **fr** : ${(b.wiki.fr ?? []).join(" · ")}\n- **en** : ${(b.wiki.en ?? []).join(" · ")}\n${b.netflix.map((n) => `- Netflix ${n.category} #${n.rank} : ${n.title}${n.season ? ` (${n.season})` : ""}`).join("\n")}`,
    `## Hashtags de la niche (légendes, 30 j, ${b.hashtagReports ?? 0} rapports, comptes bruts)\n${b.hashtags.map(([t, n]) => `${t} (${n})`).join(" · ") || "(rien)"}`,
  ];
  if (social) {
    parts.push(`## TikTok maintenant (socai, vues brutes, pas un lift)\n${social.skipped ? `- non fait : collecte socai en cours (${social.skipped})` : social.results.map((r) => `- **${r.query}**${r.error ? ` : erreur ${r.error}` : ""}\n${r.cards.slice(0, 5).map((c) => `  - ${c.views ? `${c.views.toLocaleString("fr-FR")} vues` : "vues n/c"} · ${c.days ?? "?"} j · ${c.author} · ${c.caption} ${c.url ?? ""}`).join("\n")}`).join("\n")}`);
  }
  parts.push(`## Veille Instagram (à la main)\n${igNotes.trim() || "(vide)"}`);
  return parts.join("\n\n") + "\n";
}

// One line for the notification: what matters before opening the page.
export function headline(b) {
  const next = b.matches[0];
  return [b.castInTrends.length ? `En tendance : ${b.castInTrends.slice(0, 4).join(", ")}` : null, next ? `Prochain : ${next.name}` : null, `${b.radar.length} histoires radar`].filter(Boolean).join(" · ");
}

// Phone-sized digest for Telegram (HTML parse mode, under the 4096-char limit).
export function telegramDigest(b) {
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fr = (iso) => new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const lines = [
    `<b>Veille actu ${b.date}</b>`,
    b.castInTrends.length ? `🔥 En tendance : ${esc(b.castInTrends.join(", "))}` : null,
    `\n<b>Matchs</b>`, ...b.matches.slice(0, 4).map((m) => `• ${fr(m.date)} ${esc(m.name)}`),
    `\n<b>Radar</b>`, ...b.radar.slice(0, 5).map((i) => `• ${i.score == null ? "" : `${Math.round(i.score)} `}<a href="${esc(i.link)}">${esc(i.title.slice(0, 110))}</a>`),
    `\n<b>X</b>`, ...Object.entries(b.x).map(([c, t]) => `• ${esc(c)} : ${esc(t.slice(0, 6).join(" · "))}`),
    b.reddit.length ? `\n<b>r/soccer</b>\n${b.reddit.slice(0, 3).map((i) => `• ${esc(i.title.slice(0, 110))}`).join("\n")}` : null,
    b.missing.length ? `\n<i>Muettes : ${esc(b.missing.join(", "))}</i>` : null,
  ].filter((l) => l != null);
  return lines.join("\n").slice(0, 4000);
}

export async function writeBrief(file, markdown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, markdown);
  return file;
}

export const readOptional = (file) => readFile(file, "utf8").catch(() => "");
