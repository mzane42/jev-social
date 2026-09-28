import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getHomeDir } from "../../config.js";

export function databasePath(env = process.env) {
  return path.resolve(env.JEV_SOCIAL_DB || path.join(getHomeDir(env), "jev-social.db"));
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  niche TEXT NOT NULL, account TEXT NOT NULL, date TEXT NOT NULL,
  captured_at TEXT, data TEXT NOT NULL,
  PRIMARY KEY (niche, account, date)
);
CREATE TABLE IF NOT EXISTS classifications (
  url TEXT NOT NULL, deck_version TEXT NOT NULL, niche TEXT NOT NULL,
  theme TEXT NOT NULL, theme_conf REAL NOT NULL,
  format TEXT NOT NULL, format_conf REAL NOT NULL,
  news TEXT NOT NULL, news_conf REAL NOT NULL,
  model TEXT, classified_at TEXT NOT NULL,
  PRIMARY KEY (url, deck_version)
);
CREATE TABLE IF NOT EXISTS candidates (
  niche TEXT NOT NULL, account TEXT NOT NULL, score INTEGER NOT NULL,
  signals TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL,
  PRIMARY KEY (niche, account)
);`;

export function openDatabase(file) {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  if (file !== ":memory:") chmodSync(file, 0o600);
  db.exec(SCHEMA);
  return db;
}

// Same port as fs-repository (save / listLatest / writeIndex): data lives in SQLite,
// report.html and index pages stay files under the reports root (written through `files`).
export function createSqliteRepository({ db, files, now = () => new Date() }) {
  const upsert = db.prepare(`INSERT INTO reports (niche, account, date, captured_at, data) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (niche, account, date) DO UPDATE SET captured_at = excluded.captured_at, data = excluded.data`);
  const latest = db.prepare(`SELECT niche, account, date, data FROM reports r
    WHERE date = (SELECT MAX(date) FROM reports WHERE niche = r.niche AND account = r.account) ORDER BY niche, account`);
  const putClass = db.prepare(`INSERT OR REPLACE INTO classifications
    (url, deck_version, niche, theme, theme_conf, format, format_conf, news, news_conf, model, classified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const getClass = db.prepare("SELECT * FROM classifications WHERE deck_version = ? AND niche = ?");
  const putCandidate = db.prepare(`INSERT INTO candidates (niche, account, score, signals, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (niche, account) DO UPDATE SET score = excluded.score, signals = excluded.signals, last_seen = excluded.last_seen`);

  const put = ({ snapshot, metrics, insights, insightNotice = null }) => {
    const account = `${snapshot.platform}@${snapshot.handle}`;
    const date = snapshot.capturedAt.slice(0, 10);
    upsert.run(snapshot.niche, account, date, snapshot.capturedAt, JSON.stringify({ snapshot, metrics, insights, insightNotice }));
    return { account, date };
  };

  return {
    async save(record) {
      const { account, date } = put(record);
      const file = await files.writeIndex(path.join(record.snapshot.niche, account, date, "report.html"), record.html);
      return { dir: path.dirname(file) };
    },
    importReport(data) {
      return put(data);
    },
    async listLatest() {
      return latest.all().map(({ niche, account, date, data }) => ({ niche, account, date, href: `${account}/${date}/report.html`, data: JSON.parse(data) }));
    },
    async writeIndex(relativePath, html) {
      return files.writeIndex(relativePath, html);
    },
    classifications(deckVersion, niche) {
      return new Map(getClass.all(deckVersion, niche).map((row) => [row.url, {
        theme: { value: row.theme, confidence: row.theme_conf },
        format: { value: row.format, confidence: row.format_conf },
        news: { value: row.news, confidence: row.news_conf },
        model: row.model,
      }]));
    },
    saveCandidates(niche, candidates) {
      const at = now().toISOString();
      for (const c of candidates) putCandidate.run(niche, c.account, c.score, JSON.stringify(c.signals), at, at);
    },
    saveClassifications(deckVersion, niche, byUrl) {
      const at = now().toISOString();
      for (const [url, c] of byUrl) {
        putClass.run(url, deckVersion, niche, c.theme.value, c.theme.confidence, c.format.value, c.format.confidence, c.news.value, c.news.confidence, c.model ?? null, at);
      }
    },
  };
}
