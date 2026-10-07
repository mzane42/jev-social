import { execFile } from "node:child_process";
import { promisify } from "node:util";

// When socai reads a TikTok header but the video grid comes back empty ("Une erreur est
// survenue", author_videos_incomplete), yt-dlp lists the same videos with full counts,
// without the socai Chrome. The socai header (followers, likes, bio) is kept.
// ponytail: no top comments from yt-dlp; deep reads still need a working socai grid.

const exec = promisify(execFile);

export async function runYtdlp(url, videos, { signal } = {}) {
  const { stdout } = await exec("yt-dlp", ["--flat-playlist", "-J", "--playlist-end", String(videos), "--", url], {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
    signal,
  });
  return JSON.parse(stdout);
}

export function normalizeYtdlp(playlist, handle) {
  return (playlist?.entries || [])
    .filter((entry) => entry?.id)
    .map((entry) => ({
      url: `https://www.tiktok.com/@${handle}/video/${entry.id}`,
      kind: "video",
      caption: entry.description || entry.title || null,
      createdAt: entry.timestamp ? new Date(entry.timestamp * 1000).toISOString() : null,
      durationSeconds: entry.duration ?? null,
      views: entry.view_count ?? null,
      likes: entry.like_count ?? null,
      comments: entry.comment_count ?? null,
      shares: entry.repost_count ?? null,
      saves: entry.save_count ?? null,
      topComments: [],
      detailCaptured: false,
    }));
}

const COUNTS = ["views", "likes", "comments", "shares", "saves", "durationSeconds", "createdAt"];
const videoId = (url) => String(url).match(/video\/(\d+)/)?.[1];

// The grid also stops showing view counts past a scroll depth (10 of 50 on
// @bauimmobilienaktuell0): fill the missing counts by video id, keep socai's deep reads.
function fillCounts(gridItems, ytItems) {
  const byId = new Map(ytItems.map((item) => [videoId(item.url), item]));
  return gridItems.map((item) => {
    const yt = byId.get(videoId(item.url));
    if (!yt) return item;
    const filled = { ...item };
    for (const key of COUNTS) filled[key] ??= yt[key];
    return filled;
  });
}

export function withYtdlpFallback(collector, { run = runYtdlp } = {}) {
  return {
    async collect(args) {
      const got = await collector.collect(args);
      if (args.platform !== "tiktok") return got;
      if (got.items.length && got.items.every((item) => item.views != null)) return got;
      let items;
      try {
        items = normalizeYtdlp(await run(args.url, args.videos, { signal: args.signal }), args.handle);
      } catch (error) {
        if (got.items.length) return got;
        return { ...got, partialReason: `${got.partialReason}; yt-dlp fallback failed: ${error.message}` };
      }
      if (!items.length) return got;
      if (got.items.length) return { ...got, items: fillCounts(got.items, items), itemsSource: "socai+yt-dlp" };
      return { ...got, items, partial: false, partialReason: null, itemsSource: "yt-dlp" };
    },
  };
}
