import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { requestDecision } from "./decision-provider.js";

// Story radar: football news (RSS) → cast match → Jev questions (research doc §2.A) → priority in code.
// Config: `radar` key of niches/<niche>.json ({ feeds, registry, extraCast }).

const MAX_AGE_H = 72;

const strip = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ")
  .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/** RSS 2.0 items. ponytail: regex, not an XML parser; enough for BBC/Sky/ESPN/Google News feeds. */
export function parseRss(xml, source) {
  return [...String(xml).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)].map(([, body]) => {
    const tag = (name) => strip(body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? "");
    const published = Date.parse(tag("pubDate"));
    return {
      title: tag("title"),
      link: tag("link"),
      summary: tag("description").slice(0, 400),
      source: tag("source") || source,
      publishedAt: Number.isNaN(published) ? null : new Date(published).toISOString(),
    };
  }).filter((item) => item.title && item.link);
}

export const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Cast = names in `@char_FMD_<name>_<state>` tags of the asset registry, plus extras. */
export function castFrom(registryText, extra = [], ignore = []) {
  const names = [...String(registryText).matchAll(/@char_FMD_([a-z]+)_/gi)].map((m) => m[1].toLowerCase());
  const skip = new Set(ignore.map(fold));
  return [...new Set([...names, ...extra.map(fold)])].filter((name) => !skip.has(name));
}

export function castIn(text, cast) {
  const t = ` ${fold(text).replace(/[^a-z0-9]+/g, " ")} `;
  return cast.filter((name) => t.includes(` ${name} `));
}

/** Same set of 2+ cast names = same story (ponytail: crude, splits a story told with one name). */
export const storyKey = (id, cast) => (cast.length >= 2 ? [...cast].sort().join("+") : id);

export const itemId = (title) => createHash("sha256").update(fold(title).replace(/[^a-z0-9]+/g, " ").trim()).digest("hex").slice(0, 16);

const LEVELS = (task, labels) => ({ task, criteria: Object.fromEntries(labels.map((label, i) => [String(i), label])) });

export const RADAR_QUESTIONS = {
  is_football: LEVELS("Is this item substantively about football (players, clubs, competitions, owners, agents)?", ["No", "Yes"]),
  drama: LEVELS("How much conflict, rivalry, betrayal, scandal or public falling-out does this item describe?", [
    "None, routine news", "Mild tension or disagreement", "Open conflict or public callout", "Major scandal, betrayal or rupture"]),
  manga: LEVELS("How well does this story's shape map onto a shonen manga arc (rival, underdog, betrayal, redemption, tournament stakes)?", [
    "No arc shape", "Weak arc shape", "Clear arc shape", "Ready-made arc"]),
  characters: LEVELS("How clearly can it be told through 2 to 4 named, recognizable people?", [
    "No clear characters", "One clear character", "A clear protagonist and antagonist", "A full cast with clear roles"]),
  verifiability: { task: "How verifiable is the core claim right now?", criteria: {
    confirmed: "Official confirmation or on-record quote", reported: "Credible outlet reporting, unconfirmed", rumor: "Speculation or anonymous claim only" } },
  emotion: { task: "Main emotion this item provokes in a football-drama audience?", criteria: {
    anger: "Outrage or injustice", schadenfreude: "A rival's misfortune", hope: "Underdog or comeback", shock: "Surprise reveal",
    sadness: "Loss or tragedy", none: "Flat, no strong emotion" } },
  risk: LEVELS("Could covering it create legal or reputational risk (unverified serious allegations, minors, private medical or legal matters)?", ["No", "Yes"]),
};

export function buildRadarRequest(model, item) {
  const rules = ["Judge only from the headline and summary given.", "Pick the lowest level when unsure."];
  return {
    model,
    state: { headline: item.title, summary: item.summary, source: item.source },
    questions: Object.fromEntries(Object.entries(RADAR_QUESTIONS).map(([key, q]) => [key, { type: "choice", instructions: { task: q.task, rules }, criteria: q.criteria }])),
  };
}

export function readRadarAnswers(response) {
  return Object.fromEntries(Object.entries(RADAR_QUESTIONS).map(([key, q]) => {
    const a = response?.answers?.[key];
    if (a?.type !== "choice" || !Object.hasOwn(q.criteria, a.choice)) throw new Error(`Jev returned an invalid "${key}" answer.`);
    return [key, a.choice];
  }));
}

/** 0–100. Story strength × cast fit × freshness; rumors halved, risky items cut to 30%. Off-topic = 0. */
export function priority(jev, castCount, ageHours) {
  if (!jev || jev.is_football !== "1") return 0;
  const story = (Number(jev.drama) + Number(jev.manga) + Number(jev.characters)) / 9;
  const cast = castCount > 0 ? 1 : 0.6;
  const fresh = Math.max(0, 1 - Math.max(0, ageHours) / MAX_AGE_H);
  const trust = jev.verifiability === "rumor" ? 0.5 : 1;
  const risk = jev.risk === "1" ? 0.3 : 1;
  return Math.round(100 * story * cast * (0.5 + 0.5 * fresh) * trust * risk);
}

const RADAR_SCHEMA = `CREATE TABLE IF NOT EXISTS radar_items (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, link TEXT NOT NULL, source TEXT, summary TEXT,
  published_at TEXT, cast_names TEXT NOT NULL DEFAULT '[]', story TEXT, jev TEXT, score REAL, model TEXT,
  fetched_at TEXT NOT NULL, scored_at TEXT
)`;

export async function runRadar({ db, deck, fetchImpl = fetch, provider, apiKey, max = 40, jev = true, log = () => {}, now = () => new Date() }) {
  const cfg = deck?.radar;
  if (!cfg?.feeds?.length) throw new Error(`niches/${deck?.niche}.json has no "radar.feeds".`);
  db.exec(RADAR_SCHEMA);
  const cast = castFrom(cfg.registry ? await readFile(cfg.registry, "utf8").catch(() => "") : "", cfg.extraCast ?? [], cfg.castIgnore ?? []);
  const feeds = [
    ...cfg.feeds,
    ...(cfg.castSearch ? cast.map((name) => ({ name: `Google News: ${name}`, url: cfg.castSearch.replace("{q}", encodeURIComponent(`${name} football when:3d`)) })) : []),
  ];

  const at = now();
  const items = new Map();
  for (const feed of feeds) {
    try {
      const res = await fetchImpl(feed.url, { redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const item of parseRss(await res.text(), feed.name)) {
        const age = item.publishedAt ? (at - Date.parse(item.publishedAt)) / 36e5 : 0;
        if (age > MAX_AGE_H) continue;
        items.set(itemId(item.title), { ...item, cast: castIn(`${item.title} ${item.summary}`, cast), age });
      }
    } catch (error) {
      log(`radar: ${feed.name} skipped (${error.message})`);
    }
  }

  const put = db.prepare(`INSERT INTO radar_items (id, title, link, source, summary, published_at, cast_names, story, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET cast_names = excluded.cast_names, story = excluded.story, fetched_at = excluded.fetched_at`);
  for (const [id, it] of items) put.run(id, it.title, it.link, it.source, it.summary, it.publishedAt, JSON.stringify(it.cast), storyKey(id, it.cast), at.toISOString());

  // Jev once per story (its newest item), stories already scored skipped, widest coverage first; `max` caps the spend.
  const scored = new Set(db.prepare("SELECT story FROM radar_items WHERE jev IS NOT NULL").all().map((r) => r.story));
  const stories = new Map();
  for (const [id, it] of items) {
    const key = storyKey(id, it.cast);
    const s = stories.get(key) ?? { n: 0, best: null };
    s.n += 1;
    if (!s.best || it.age < s.best[1].age) s.best = [id, it];
    stories.set(key, s);
  }
  const queue = [...stories].filter(([key]) => !scored.has(key))
    .sort(([, a], [, b]) => b.best[1].cast.length - a.best[1].cast.length || b.n - a.n || a.best[1].age - b.best[1].age)
    .slice(0, jev ? max : 0).map(([, s]) => s.best);
  const save = db.prepare("UPDATE radar_items SET jev = ?, score = ?, model = ?, scored_at = ? WHERE id = ?");
  let done = 0;
  for (const [id, it] of queue) {
    try {
      const response = await requestDecision({ provider, apiKey, request: buildRadarRequest(provider.model, it), fetchImpl });
      const answers = readRadarAnswers(response);
      save.run(JSON.stringify(answers), priority(answers, it.cast.length, it.age), response?.model ?? provider.model, now().toISOString(), id);
      done++;
    } catch (error) {
      log(`radar: Jev failed on "${it.title.slice(0, 60)}" (${error.message})`);
    }
  }
  return { feeds: feeds.length, fresh: items.size, castMatched: [...items.values()].filter((i) => i.cast.length).length, scored: done, cast };
}
