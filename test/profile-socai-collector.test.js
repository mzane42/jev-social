import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { cleanInstagramComment, createSocaiCollector, createSocaiRunJson, normalizeInstagram, normalizeTikTok } from "../src/profile/adapters/socai-collector.js";

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/profile/${name}`, import.meta.url), "utf8"));

test("TikTok collection reads the author, then top videos by full URL without downloads", async () => {
  const author = await fixture("tiktok-author.json");
  const videos = await fixture("tiktok-videos.json");
  const calls = [];
  const collector = createSocaiCollector({
    async runJson(args) {
      calls.push(args);
      return args[1] === "author" ? author : videos;
    },
  });
  const result = await collector.collect({ platform: "tiktok", handle: "demo_creator", url: "https://www.tiktok.com/@demo_creator", videos: 12, deep: 2 });
  assert.deepEqual(calls[0], ["tiktok", "author", "https://www.tiktok.com/@demo_creator", "--num", "12", "--pretty"]);
  assert.deepEqual(calls[1], [
    "tiktok", "get-videos",
    "--video", "https://www.tiktok.com/@demo_creator/video/222",
    "--video", "https://www.tiktok.com/@demo_creator/video/111",
    "--num-comments", "8", "--pretty",
  ]);
  assert.ok(calls.flat().every((arg) => !["--download-media", "--transcribe-audio"].includes(arg)));
  assert.equal(result.partial, true);
  assert.equal(result.partialReason, "deep reads failed: 1/2 completed (navigation_timeout)");
  assert.equal(result.items.length, 3);
});

test("TikTok collection skips the deep step when no cards were captured", async () => {
  const calls = [];
  const collector = createSocaiCollector({
    async runJson(args) {
      calls.push(args);
      return { ok: false, reason: "author_videos_incomplete", profile: { followers: "53400", video_cards: [] } };
    },
  });
  const result = await collector.collect({ platform: "tiktok", handle: "demo_creator", url: "https://www.tiktok.com/@demo_creator", videos: 12, deep: 3 });
  assert.equal(calls.length, 1);
  assert.equal(result.partial, true);
  assert.equal(result.partialReason, "author_videos_incomplete");
  assert.equal(result.profile.followers, 53400);
});

test("TikTok author page that never hydrates reports not found with the socai reason, not a login", async () => {
  const observed = { handle: "recette1min", login_required: false, challenge_required: false, unavailable: false, author_internal_id: "" };
  const collector = createSocaiCollector({
    async runJson() { return { ok: false, reason: "navigation_timeout", state: { observed_state: observed } }; },
  });
  await assert.rejects(
    collector.collect({ platform: "tiktok", handle: "recette1min", url: "https://www.tiktok.com/@recette1min", videos: 12, deep: 3 }),
    { code: "PROFILE_NOT_FOUND", message: "No profile data captured for @recette1min (socai: navigation_timeout): the account may be private or not exist." },
  );
});

test("TikTok author page behind a login gate asks the user to log in", async () => {
  const collector = createSocaiCollector({
    async runJson() { return { ok: false, reason: "login_required", state: { observed_state: { login_required: true } } }; },
  });
  await assert.rejects(
    collector.collect({ platform: "tiktok", handle: "demo_creator", url: "https://www.tiktok.com/@demo_creator", videos: 12, deep: 3 }),
    { code: "PROFILE_LOGIN_REQUIRED" },
  );
});

test("TikTok empty capture keeps followers and likes unknown instead of zero", async () => {
  const collector = createSocaiCollector({
    async runJson() {
      return { ok: false, reason: "author_videos_incomplete", profile: { followers: "0", likes: "0", video_count: "", video_cards: [] } };
    },
  });
  const result = await collector.collect({ platform: "tiktok", handle: "yummyaccount", url: "https://www.tiktok.com/@yummyaccount", videos: 12, deep: 3 });
  assert.equal(result.profile.followers, null);
  assert.equal(result.profile.likes, null);
  assert.equal(normalizeTikTok({ ok: true, profile: { followers: "0", video_count: "0" } }).profile.followers, 0);
});

test("TikTok deep step that fails without returning any video names the failure count, not 0/0", () => {
  const result = normalizeTikTok({ ok: true, profile: { video_cards: [] } }, { failures: 2, videos: [] });
  assert.equal(result.partialReason, "deep reads failed: 2 failure(s), no video returned");
});

test("collection without any profile data asks the user to log in", async () => {
  const collector = createSocaiCollector({ async runJson() { return { ok: false, login_required: true }; } });
  await assert.rejects(
    collector.collect({ platform: "instagram", handle: "demo_ig", url: "https://www.instagram.com/demo_ig/", videos: 12, deep: 3 }),
    { code: "PROFILE_LOGIN_REQUIRED", message: /log in to instagram in the socai Chrome window/ },
  );
});

test("collection with a challenge gate asks the user to log in", async () => {
  const collector = createSocaiCollector({ async runJson() { return { ok: false, challenge_required: true }; } });
  await assert.rejects(
    collector.collect({ platform: "instagram", handle: "demo_ig", url: "https://www.instagram.com/demo_ig/", videos: 12, deep: 3 }),
    { code: "PROFILE_LOGIN_REQUIRED" },
  );
});

test("Instagram collection with no followers and no login gate reports profile not found", async () => {
  const collector = createSocaiCollector({ async runJson() { return { ok: true, followers: null, posts: [] }; } });
  await assert.rejects(
    collector.collect({ platform: "instagram", handle: "demo_ig", url: "https://www.instagram.com/demo_ig/", videos: 12, deep: 3 }),
    { code: "PROFILE_NOT_FOUND", message: "No profile data captured for @demo_ig: the account may be private or not exist." },
  );
});

test("normalizeTikTok merges deep stats into cards and keeps unknowns null", async () => {
  const result = normalizeTikTok(await fixture("tiktok-author.json"), await fixture("tiktok-videos.json"));
  assert.deepEqual(result.profile, { displayName: "Demo Studio", bio: "Anime football highlights", followers: 53400, likes: 1_500_000, postCount: 82 });
  const top = result.items.find((item) => item.url.endsWith("/222"));
  assert.deepEqual(top, {
    url: "https://www.tiktok.com/@demo_creator/video/222", kind: "video", caption: "World cup #anime",
    createdAt: "2026-07-05T22:28:27.000Z", durationSeconds: 33,
    views: 2_200_000, likes: 134_600, comments: 736, shares: 42_900, saves: 13_298,
    topComments: [{ text: "Someone will say this is AI.", likes: 601 }],
    detailCaptured: true,
  });
  const shallow = result.items.find((item) => item.url.endsWith("/333"));
  assert.equal(shallow.views, 1215);
  assert.equal(shallow.likes, null);
  assert.equal(shallow.caption, "Derby");
  assert.equal(shallow.durationSeconds, null);
  assert.equal(shallow.detailCaptured, false);
  const failed = result.items.find((item) => item.url.endsWith("/111"));
  assert.equal(failed.detailCaptured, false);
});

test("Instagram collection uses one profile call with deep reads", async () => {
  const raw = await fixture("instagram-profile.json");
  const calls = [];
  const collector = createSocaiCollector({ async runJson(args) { calls.push(args); return raw; } });
  const result = await collector.collect({ platform: "instagram", handle: "demo_ig", url: "https://www.instagram.com/demo_ig/", videos: 12, deep: 3 });
  assert.deepEqual(calls, [["instagram", "profile", "https://www.instagram.com/demo_ig/", "--num", "12", "--deep", "3", "--num-comments", "8", "--pretty"]]);
  assert.equal(result.profile.followers, 427000);
  assert.equal(result.profile.bio, null);
});

test("normalizeInstagram keeps views and likes null and strips comment UI noise", async () => {
  const result = normalizeInstagram(await fixture("instagram-profile.json"));
  assert.equal(result.partial, false);
  const [reel, post] = result.items;
  assert.equal(reel.caption, "Dictator striker please let him score");
  assert.equal(reel.createdAt, "2026-07-01T00:00:00.000Z");
  assert.equal(reel.views, null);
  assert.equal(reel.likes, null);
  assert.deepEqual(reel.topComments, [{ text: "I want the whole series about this", likes: null }]);
  assert.equal(reel.detailCaptured, true);
  assert.equal(post.caption, null);
  assert.deepEqual(post.topComments, []);
  assert.equal(post.detailCaptured, false);
  assert.equal(cleanInstagramComment("ok\n3 j2 J'aimeRépondre"), "ok");
});

test("normalizeInstagram builds partialReason from deep_posts reasons when deep_status.ok is false", async () => {
  const result = normalizeInstagram(await fixture("instagram-profile-deep-failed.json"));
  assert.equal(result.partial, true);
  assert.equal(result.partialReason, "deep reads failed: 0/3 completed (post_not_open)");
});

test("createSocaiRunJson forces telemetry off and accepts injectable resolveBin/run", async () => {
  let resolveArgs;
  let runArgs;
  const runJson = createSocaiRunJson({
    config: { some: "config" },
    env: { PATH: "x" },
    resolveBin: async (config, env) => { resolveArgs = { config, env }; return "/bin/socai"; },
    run: async (bin, args, options) => { runArgs = { bin, args, options }; return { data: { ok: true } }; },
  });
  const result = await runJson(["status"], { signal: undefined });
  assert.deepEqual(result, { ok: true });
  assert.equal(runArgs.bin, "/bin/socai");
  assert.deepEqual(runArgs.args, ["status"]);
  assert.equal(runArgs.options.env.SOCAI_TELEMETRY, "0");
  assert.equal(runArgs.options.env.SOCAI_TELEMETRY_QUERY_TEXT, "off");
  assert.equal(runArgs.options.env.SOCAI_NO_UPDATE_CHECK, "1");
  assert.equal(resolveArgs.env.SOCAI_TELEMETRY, "0");
  assert.equal(resolveArgs.config.some, "config");
});
