import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeMedia, pickMediaTargets } from "../src/profile/analyze.js";
import { classificationText } from "../src/profile/adapters/jev-classifier.js";
import { createLocalMedia, findVideoPath, parseAudioStats } from "../src/profile/adapters/media.js";
import { createSqliteRepository, openDatabase } from "../src/profile/adapters/sqlite-repository.js";

const url = (n) => `https://www.tiktok.com/@fcs/video/${n}`;
const entry = (views) => ({
  niche: "football-anime", account: "tiktok@fcs", date: "2026-09-28",
  data: { snapshot: { platform: "tiktok", niche: "football-anime", items: views.map((v, i) => ({ url: url(i), views: v, caption: `#anime ${i}`, topComments: [] })) } },
});

test("findVideoPath takes the first video local_path at any depth and ignores images", () => {
  assert.equal(findVideoPath({ entity: { cover: { local_path: "/r/c.jpg" }, video: { local_path: "/r/v.mp4" } } }), "/r/v.mp4");
  assert.equal(findVideoPath({ entity: { local_path: "/r/c.jpg" } }), null);
});

test("pickMediaTargets keeps top N and bottom M by views, skips done, retries errors", () => {
  const e = entry([10, 900, 50, 400, 5, null, 70]);
  const [target] = pickMediaTargets([e], new Map(), { top: 2, flops: 2 });
  assert.deepEqual(target.items.map((i) => i.views), [900, 400, 10, 5]);
  const done = new Map([[url(1), { transcript: "x" }], [url(3), { error: "download failed" }]]);
  assert.deepEqual(pickMediaTargets([e], done, { top: 2, flops: 2 })[0].items.map((i) => i.views), [400, 10, 5]);
});

test("classification text carries the spoken transcript for hashtag-only captions", () => {
  const text = classificationText({ caption: "#piscine créé par X avec son", topComments: [], transcript: "Aujourd'hui je nettoie une piscine verte" });
  assert.equal(text.caption, "#piscine");
  assert.equal(text.spoken_transcript, "Aujourd'hui je nettoie une piscine verte");
  assert.ok(classificationText({ caption: null, topComments: [], transcript: "hello" }));
});

test("analyzeMedia runs download → frames → transcript → hook, records failures, re-classifies with transcripts", async () => {
  const repo = createSqliteRepository({ db: openDatabase(":memory:"), files: { async writeIndex(rel) { return rel; } } });
  const e = entry([100, 900, 50]);
  repo.importReport({ snapshot: { ...e.data.snapshot, handle: "fcs", capturedAt: "2026-09-28T10:00:00Z" }, metrics: {}, insights: [] });
  repo.saveClassifications("v1", "football-anime", new Map([[url(1), { theme: { value: "other", confidence: 1 }, format: { value: "other", confidence: 1 }, news: { value: "evergreen", confidence: 1 } }]]));
  const seen = [];
  const media = {
    async download(urls) { return new Map(urls.filter((u) => u !== url(2)).map((u) => [u, `/m/${u.split("/").pop()}/video.mp4`])); },
    async frames(p) { return [p.replace("video.mp4", "frame-0s.jpg")]; },
    async transcribe() { return { text: "Haaland scores", head: "Haaland" }; },
    async readHook() { return { hookType: "star_closeup", note: "Haaland close-up", model: "m" }; },
  };
  const classifier = { async classify({ items }) { seen.push(...items.map((i) => i.transcript)); return new Map(); } };
  const deck = { niche: "football-anime", themes: { other: "x" }, formats: { other: "x" }, version: "v1" };
  const result = await analyzeMedia({ media, repository: repo, classifier, loadDeck: async () => deck }, { niche: "football-anime", top: 2, flops: 1 });
  assert.equal(result.processed, 2);
  const saved = repo.media("football-anime");
  assert.equal(saved.get(url(1)).hook_type, "star_closeup");
  assert.deepEqual(saved.get(url(1)).frames, ["/m/1/frame-0s.jpg"]);
  assert.equal(saved.get(url(2)).error, "download failed");
  assert.equal(repo.classifications("v1", "football-anime").has(url(1)), false, "transcript drops the stale classification");
  assert.ok(seen.includes("Haaland scores"));
});

test("readHook is off without a key or model and rejects an unknown or empty answer", async () => {
  assert.equal(await createLocalMedia({ runJson: null, apiKey: "", root: "/tmp" }).readHook({ frames: ["x"], head: "" }), null);
  const fetchImpl = async () => Response.json({ model: "vision-x", choices: [{ message: { content: JSON.stringify({ hook_type: "invented", first_seconds: "A goal." }) } }] });
  const m = createLocalMedia({ runJson: null, apiKey: "k", root: "/tmp", fetchImpl });
  const frame = new URL("./fixtures/profile/tiktok-author.json", import.meta.url).pathname;
  await assert.rejects(m.readHook({ frames: [frame], head: "", caption: "" }), /unknown hook type/);
  const empty = createLocalMedia({ runJson: null, apiKey: "k", root: "/tmp", fetchImpl: async () => Response.json({ choices: [{ message: { content: "" } }] }) });
  await assert.rejects(empty.readHook({ frames: [frame], head: "", caption: "" }), /no JSON/);
  const ok = createLocalMedia({ runJson: null, apiKey: "k", root: "/tmp", fetchImpl: async () => Response.json({ model: "v", choices: [{ message: { content: JSON.stringify({ hook_type: "scoreline", first_seconds: "2-0 on screen." }) } }] }) });
  assert.deepEqual(await ok.readHook({ frames: [frame], head: "", caption: "" }), { hookType: "scoreline", note: "2-0 on screen.", model: "v" });
});

test("download asks socai for media without paid transcription and copies files under the media root", async () => {
  const calls = [];
  const m = createLocalMedia({ root: "/nonexistent-root", async runJson(args) { calls.push(args); return { videos: [] }; } });
  assert.equal((await m.download([url(1)])).size, 0);
  assert.ok(calls[0].includes("--download-media"));
  assert.ok(!calls[0].includes("--transcribe-audio"));
});

test("download keeps a saved video when socai exits 1 on a failed poster; rethrows without JSON or on a login gate", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "jev-media-"));
  const saved = path.join(tmp, "video.mp4");
  await writeFile(saved, "mp4");
  const fail = (data) => Object.assign(new Error("socai CLI failed"), { details: { exitCode: 1, ...(data ? { data } : {}) } });
  const videos = [{ ok: false, reason: "poster_download_failed", entity: { url: url(1) }, media: { local_path: saved } }];
  const partial = createLocalMedia({ root: path.join(tmp, "root"), async runJson() { throw fail({ videos }); } });
  const out = await partial.download([url(1)]);
  assert.equal(out.size, 1);
  assert.equal(await readFile(out.get(url(1)), "utf8"), "mp4");
  const empty = createLocalMedia({ root: tmp, async runJson() { throw fail({ videos: [{ ok: false, entity: { url: url(2) } }] }); } });
  await assert.rejects(() => empty.download([url(2)]), /socai CLI failed/);
  const broken = createLocalMedia({ root: tmp, async runJson() { throw fail(); } });
  await assert.rejects(() => broken.download([url(1)]), /socai CLI failed/);
  const gated = createLocalMedia({ root: tmp, async runJson() { throw fail({ videos, login_required: true }); } });
  await assert.rejects(() => gated.download([url(1)]), /socai CLI failed/);
  await rm(tmp, { recursive: true, force: true });
});

test("rehook re-reads hooks from saved frames, keeps transcript and classification, never downloads", async () => {
  const repo = createSqliteRepository({ db: openDatabase(":memory:"), files: { async writeIndex(rel) { return rel; } } });
  repo.saveMedia("football-anime", { url: url(1), videoPath: "/m/v.mp4", frames: ["/m/f0.jpg"], transcript: "full text", head: "full", hookType: "on_screen_text", note: "old" });
  repo.saveClassifications("v1", "football-anime", new Map([[url(1), { theme: { value: "other", confidence: 1 }, format: { value: "other", confidence: 1 }, news: { value: "evergreen", confidence: 1 } }]]));
  const media = {
    async download() { throw new Error("must not download"); },
    async readHook({ frames, head }) { assert.deepEqual(frames, ["/m/f0.jpg"]); assert.equal(head, "full"); return { hookType: "no_hook", note: "new", model: "g" }; },
  };
  const result = await analyzeMedia({ media, repository: repo }, { niche: "football-anime", rehook: true });
  assert.equal(result.processed, 1);
  const row = repo.media("football-anime").get(url(1));
  assert.equal(row.hook_type, "no_hook");
  assert.equal(row.transcript, "full text");
  assert.equal(repo.classifications("v1", "football-anime").has(url(1)), true);
});

test("readHook accepts JSON wrapped in a code fence", async () => {
  const fenced = "```json\n" + JSON.stringify({ hook_type: "scoreline", first_seconds: "0-0 at 80:00." }) + "\n```";
  const m = createLocalMedia({ runJson: null, apiKey: "k", root: "/tmp", fetchImpl: async () => Response.json({ model: "s", choices: [{ message: { content: fenced } }] }) });
  const frame = new URL("./fixtures/profile/tiktok-author.json", import.meta.url).pathname;
  assert.equal((await m.readHook({ frames: [frame], head: "", caption: "" })).hookType, "scoreline");
});

test("a failed rehook keeps the previous hook reading", async () => {
  const repo = createSqliteRepository({ db: openDatabase(":memory:"), files: { async writeIndex(rel) { return rel; } } });
  repo.saveMedia("football-anime", { url: url(1), frames: ["/m/f0.jpg"], transcript: "t", head: "h", hookType: "scoreline", note: "kept" });
  const media = { async readHook() { throw new Error("timeout"); } };
  const result = await analyzeMedia({ media, repository: repo }, { niche: "football-anime", rehook: true });
  assert.equal(result.processed, 0);
  assert.equal(repo.media("football-anime").get(url(1)).hook_type, "scoreline");
});

test("readHook uses a niche's own hook types and loadDeck requires no_hook in them", async () => {
  const frame = new URL("./fixtures/profile/tiktok-author.json", import.meta.url).pathname;
  const reply = (hook_type) => async () => Response.json({ choices: [{ message: { content: JSON.stringify({ hook_type, first_seconds: "A face." }) } }] });
  const hookTypes = { uncanny_face: "An impossible-looking person", no_hook: "Nothing" };
  assert.equal((await createLocalMedia({ runJson: null, apiKey: "k", root: "/tmp", fetchImpl: reply("uncanny_face") }).readHook({ frames: [frame], head: "", hookTypes })).hookType, "uncanny_face");
  await assert.rejects(createLocalMedia({ runJson: null, apiKey: "k", root: "/tmp", fetchImpl: reply("scoreline") }).readHook({ frames: [frame], head: "", hookTypes }), /unknown hook type/);
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { loadDeck } = await import("../src/profile/adapters/jev-classifier.js");
  const dir = await mkdtemp(`${(await import("node:os")).tmpdir()}/deck-`);
  const base = { themes: { other: "x" }, formats: { other: "x" } };
  await writeFile(`${dir}/a.json`, JSON.stringify({ ...base, hooks: { uncanny_face: "y" } }));
  await assert.rejects(loadDeck("a", new URL(`file://${dir}/`)), /must include "no_hook"/);
  await writeFile(`${dir}/b.json`, JSON.stringify({ ...base, hooks: hookTypes }));
  const deck = await loadDeck("b", new URL(`file://${dir}/`));
  assert.deepEqual(deck.hooks, hookTypes);
  await writeFile(`${dir}/c.json`, JSON.stringify(base));
  assert.equal((await loadDeck("c", new URL(`file://${dir}/`))).version, deck.version, "hook edits must not re-classify");
});

const FFMPEG_STDERR = `[silencedetect @ 0x1] silence_start: 0
[silencedetect @ 0x1] silence_end: 0.42 | silence_duration: 0.42
[silencedetect @ 0x1] silence_start: 30.1
[silencedetect @ 0x1] silence_end: 30.9 | silence_duration: 0.8
[Parsed_ebur128_1 @ 0x2] Summary:

  Integrated loudness:
    I:         -14.6 LUFS
    Threshold: -24.8 LUFS`;

test("parseAudioStats reads loudness, silence count and the silence before the first sound", async () => {
  assert.deepEqual(parseAudioStats(FFMPEG_STDERR), { lufs: -14.6, silences: 2, leadSilenceS: 0.42 });
  assert.deepEqual(parseAudioStats("silence_start: 3.2\nsilence_end: 4"), { lufs: null, silences: 1, leadSilenceS: 0 });
});

test("audio measures with ffmpeg, then reads the first 30 s with the audio model; a failed read keeps the stats", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "jev-audio-"));
  const video = path.join(tmp, "video.mp4");
  const exec = async (cmd, args) => {
    if (args.includes("null")) return { stdout: "", stderr: FFMPEG_STDERR };
    await writeFile(args.at(-1), "mp3");
    return { stdout: "", stderr: "" };
  };
  const bodies = [];
  const reply = { voice_starts_s: 0.15, music: true, music_style: "pizzicato", first_sfx_s: 0, sound_effects: ["impact", "whoosh"], notes: "Narration over light music." };
  const ok = createLocalMedia({ apiKey: "k", exec, fetchImpl: async (u, init) => { bodies.push(JSON.parse(init.body)); return Response.json({ model: "g", choices: [{ message: { content: JSON.stringify(reply) } }] }); } });
  const a = await ok.audio(video);
  assert.equal(a.lufs, -14.6);
  assert.deepEqual(a.read, { voiceStartsS: 0.15, music: true, musicStyle: "pizzicato", firstSfxS: 0, soundEffects: ["impact", "whoosh"], notes: "Narration over light music.", model: "g" });
  assert.equal(bodies[0].messages[0].content[1].type, "input_audio");
  const off = createLocalMedia({ apiKey: "k", audioModel: "off", exec, fetchImpl: async () => assert.fail("no call when off") });
  assert.equal((await off.audio(video)).read, null);
  const down = createLocalMedia({ apiKey: "k", exec, fetchImpl: async () => Response.json({ error: { message: "no audio" } }, { status: 404 }) });
  const d = await down.audio(video);
  assert.equal(d.lufs, -14.6);
  assert.equal(d.read.error, "no audio");
  await rm(tmp, { recursive: true, force: true });
});

test("reaudio fills audio on saved rows without touching hook or classification; rehook keeps audio", async () => {
  const repo = createSqliteRepository({ db: openDatabase(":memory:"), files: { async writeIndex(rel) { return rel; } } });
  repo.saveMedia("football-anime", { url: url(1), videoPath: "/m/v.mp4", frames: ["/m/f0.jpg"], transcript: "t", head: "h", hookType: "scoreline", note: "n" });
  repo.saveMedia("football-anime", { url: url(2), frames: [], error: "download failed" });
  repo.saveClassifications("v1", "football-anime", new Map([[url(1), { theme: { value: "other", confidence: 1 }, format: { value: "other", confidence: 1 }, news: { value: "evergreen", confidence: 1 } }]]));
  const audio = { lufs: -15, silences: 0, leadSilenceS: 0, read: null };
  const result = await analyzeMedia({ media: { async audio(p) { assert.equal(p, "/m/v.mp4"); return audio; } }, repository: repo }, { niche: "football-anime", reaudio: true });
  assert.equal(result.processed, 1);
  let row = repo.media("football-anime").get(url(1));
  assert.deepEqual(row.audio, audio);
  assert.equal(row.hook_type, "scoreline");
  assert.equal(repo.classifications("v1", "football-anime").size, 1);
  await analyzeMedia({ media: { async readHook() { return { hookType: "no_hook", note: "x", model: "m" }; } }, repository: repo }, { niche: "football-anime", rehook: true });
  row = repo.media("football-anime").get(url(1));
  assert.equal(row.hook_type, "no_hook");
  assert.deepEqual(row.audio, audio);
});

test("openDatabase adds the audio column to a media table created before it", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "jev-db-"));
  const file = path.join(tmp, "old.db");
  const { DatabaseSync } = await import("node:sqlite");
  const old = new DatabaseSync(file);
  old.exec("CREATE TABLE media (url TEXT PRIMARY KEY, niche TEXT NOT NULL, video_path TEXT, frames TEXT NOT NULL DEFAULT '[]', transcript TEXT, transcript_head TEXT, hook_type TEXT, hook_note TEXT, hook_model TEXT, error TEXT, created_at TEXT NOT NULL)");
  old.close();
  const db = openDatabase(file);
  assert.ok(db.prepare("SELECT 1 FROM pragma_table_info('media') WHERE name = 'audio'").get());
  openDatabase(file).close();
  db.close();
  await rm(tmp, { recursive: true, force: true });
});

test("audio: a video without audio stream is a result (noAudio), and the 30 s clip is removed after the listen", async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "jev-audio-"));
  const video = path.join(tmp, "video.mp4");
  const silent = createLocalMedia({ apiKey: "k", async exec() { throw Object.assign(new Error("Command failed: ffmpeg"), { stderr: "Output file does not contain any stream" }); }, fetchImpl: async () => assert.fail("no listen") });
  assert.deepEqual(await silent.audio(video), { lufs: null, silences: 0, leadSilenceS: 0, noAudio: true, read: null });
  const exec = async (cmd, args) => { if (args.includes("null")) return { stderr: FFMPEG_STDERR }; await writeFile(args.at(-1), "mp3"); return { stderr: "" }; };
  const ok = createLocalMedia({ apiKey: "k", exec, fetchImpl: async () => Response.json({ choices: [{ message: { content: "{}" } }] }) });
  await ok.audio(video);
  await assert.rejects(() => readFile(path.join(tmp, "audio-30s.mp3")));
  await rm(tmp, { recursive: true, force: true });
});

test("reaudio keeps the previous good reading when the new listen fails, and stops on abort", async () => {
  const repo = createSqliteRepository({ db: openDatabase(":memory:"), files: { async writeIndex(rel) { return rel; } } });
  const good = { voiceStartsS: 0.1, music: true, musicStyle: "pop", firstSfxS: 0, soundEffects: ["whoosh"], notes: "n", model: "g" };
  repo.saveMedia("football-anime", { url: url(1), videoPath: "/m/v.mp4", frames: [], audio: { lufs: -15, silences: 0, leadSilenceS: 0, read: good } });
  await analyzeMedia({ media: { async audio() { return { lufs: -14, silences: 1, leadSilenceS: 0, read: { error: "timeout" } }; } }, repository: repo }, { niche: "football-anime", reaudio: true });
  const row = repo.media("football-anime").get(url(1));
  assert.equal(row.audio.lufs, -14);
  assert.deepEqual(row.audio.read, good);
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(() => analyzeMedia({ media: { async audio() { throw new Error("aborted"); } }, repository: repo }, { niche: "football-anime", reaudio: true, signal: ctrl.signal }), /aborted/);
});
