import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMedia, pickMediaTargets } from "../src/profile/analyze.js";
import { classificationText } from "../src/profile/adapters/jev-classifier.js";
import { createLocalMedia, findVideoPath } from "../src/profile/adapters/media.js";
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
