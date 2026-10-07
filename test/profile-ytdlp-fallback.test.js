import assert from "node:assert/strict";
import test from "node:test";
import { withYtdlpFallback } from "../src/profile/adapters/ytdlp-fallback.js";

const header = { profile: { followers: 158400 }, items: [], partial: true, partialReason: "author_videos_incomplete" };
const args = { platform: "tiktok", handle: "ballym0ry", url: "https://www.tiktok.com/@ballym0ry", videos: 50 };
const playlist = { entries: [{ id: "7687", description: "She's a rocket #ukcomedy", timestamp: 1789852048, duration: 65, view_count: 37800, like_count: 2727, comment_count: 6, repost_count: 118, save_count: 250 }] };

test("empty TikTok grid is filled from yt-dlp, socai header kept", async () => {
  const got = await withYtdlpFallback({ collect: async () => header }, { run: async () => playlist }).collect(args);
  assert.equal(got.profile.followers, 158400);
  assert.equal(got.partial, false);
  assert.equal(got.itemsSource, "yt-dlp");
  assert.deepEqual(
    { url: got.items[0].url, views: got.items[0].views, shares: got.items[0].shares, createdAt: got.items[0].createdAt },
    { url: "https://www.tiktok.com/@ballym0ry/video/7687", views: 37800, shares: 118, createdAt: "2026-09-19T21:07:28.000Z" },
  );
});

test("grid items without view counts are filled by video id, socai comments kept", async () => {
  const grid = { ...header, items: [
    { url: "https://www.tiktok.com/@ballym0ry/video/7687", views: null, likes: 5, topComments: [{ text: "lol" }], detailCaptured: true },
    { url: "https://www.tiktok.com/@ballym0ry/video/9999", views: 10 },
  ] };
  const got = await withYtdlpFallback({ collect: async () => grid }, { run: async () => playlist }).collect(args);
  assert.equal(got.itemsSource, "socai+yt-dlp");
  assert.deepEqual(
    { views: got.items[0].views, likes: got.items[0].likes, saves: got.items[0].saves, comments: got.items[0].topComments.length },
    { views: 37800, likes: 5, saves: 250, comments: 1 },
  );
  assert.equal(got.items[1].views, 10);
});

test("a filled grid, Instagram, or a yt-dlp failure leave the socai result alone", async () => {
  const boom = async () => { throw new Error("no yt-dlp"); };
  const filled = { ...header, items: [{ url: "x", views: 3 }] };
  const unfilled = { ...header, items: [{ url: "x" }] };
  assert.equal(await withYtdlpFallback({ collect: async () => unfilled }, { run: boom }).collect(args), unfilled);
  assert.equal(await withYtdlpFallback({ collect: async () => filled }, { run: boom }).collect(args), filled);
  assert.equal(await withYtdlpFallback({ collect: async () => header }, { run: boom }).collect({ ...args, platform: "instagram" }), header);
  const failed = await withYtdlpFallback({ collect: async () => header }, { run: boom }).collect(args);
  assert.equal(failed.items.length, 0);
  assert.match(failed.partialReason, /yt-dlp fallback failed: no yt-dlp/);
});
