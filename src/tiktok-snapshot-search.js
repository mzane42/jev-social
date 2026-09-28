// ponytail: workaround for socai 0.6.1. TikTok moved its search box to the sidebar, socai's
// visible_query check stays empty, and `tiktok search` returns search_navigation_timeout with no
// cards although the results page rendered. We read the result links from the --debug-snapshot DOM.
// Delete this file once socai reads the new search box.
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { buildActionArgs } from "./actions.js";

const VIDEO_HREF = /href="(?:https:\/\/www\.tiktok\.com)?\/@([A-Za-z0-9._]{1,64})\/video\/(\d+)/g;
const RUN_DIR = /^run_dir:\s*(.+)$/m;

export function cardsFromDom(html, limit) {
  const seen = new Map();
  for (const [, handle, id] of html.matchAll(VIDEO_HREF)) {
    // 15+ digit "handles" are numeric user ids of accounts without a public @name.
    if (/^\d{15,}$/.test(handle) || seen.has(id)) continue;
    seen.set(id, { video_id: id, url: `https://www.tiktok.com/@${handle}/video/${id}` });
  }
  return [...seen.values()].slice(0, limit);
}

// Only touch a directory socai itself reported, under a .socai/runs tree, for a tiktok search.
export function snapshotRunDir(stderr) {
  const dir = RUN_DIR.exec(stderr || "")?.[1]?.trim();
  if (!dir || !path.isAbsolute(dir)) return null;
  const normal = path.normalize(dir);
  return normal.split(path.sep).includes(".socai") && /_tiktok_search_/.test(path.basename(normal)) ? normal : null;
}

export function createTiktokSnapshotSearch({ runJson }) {
  return async (query, limit, { signal } = {}) => {
    const args = [...buildActionArgs({ platform: "tiktok", kind: "search", query, limit }), "--debug-snapshot"];
    const result = await runJson(args, { signal, full: true });
    const data = result.data;
    const runDir = snapshotRunDir(result.stderr);
    if (!runDir) return data;
    const snapshots = path.join(runDir, "snapshots");
    try {
      if (data?.ok !== false || data.reason !== "search_navigation_timeout" || data.cards?.length) return data;
      const last = (await readdir(snapshots, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort().at(-1);
      if (!last) return data;
      const cards = cardsFromDom(await readFile(path.join(snapshots, last, "dom.html"), "utf8"), limit);
      return cards.length ? { ...data, ok: true, reason: null, cards, count: cards.length, recovered: "the page snapshot" } : data;
    } finally {
      // Snapshots are ~12 MB per search and hold the full page; keep only socai's own output.
      await rm(snapshots, { recursive: true, force: true });
    }
  };
}
