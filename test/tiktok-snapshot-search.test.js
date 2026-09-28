import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cardsFromDom, createTiktokSnapshotSearch, snapshotRunDir } from "../src/tiktok-snapshot-search.js";

const dom = await readFile(new URL("./fixtures/discover/tiktok-search-dom.html", import.meta.url), "utf8");
const timeout = { ok: false, reason: "search_navigation_timeout", cards: [] };

test("cardsFromDom keeps tiktok video links, dedupes, drops numeric ids and other hosts", () => {
  assert.deepEqual(cardsFromDom(dom, 10).map((c) => c.url), [
    "https://www.tiktok.com/@tmfooty.ai/video/7580000000000000001",
    "https://www.tiktok.com/@nescalingai/video/7580000000000000002",
    "https://www.tiktok.com/@gorlami.ai/video/7580000000000000004",
  ]);
  assert.equal(cardsFromDom(dom, 1).length, 1);
});

test("snapshotRunDir only accepts a socai tiktok search run dir", () => {
  assert.equal(snapshotRunDir("run_dir: /u/.socai/runs/20260928_1_tiktok_search_x\n"), "/u/.socai/runs/20260928_1_tiktok_search_x");
  assert.equal(snapshotRunDir("run_dir: /u/.socai/runs/20260928_1_instagram_profile"), null);
  assert.equal(snapshotRunDir("run_dir: /etc/x_tiktok_search_y"), null);
  assert.equal(snapshotRunDir("run_dir: relative/.socai/runs/a_tiktok_search_b"), null);
  assert.equal(snapshotRunDir(""), null);
});

async function fakeRun(data) {
  const runDir = path.join(await mkdtemp(path.join(tmpdir(), "jev-")), ".socai", "runs", "20260928_1_tiktok_search_q");
  for (const name of ["00001_a", "00002_b"]) await mkdir(path.join(runDir, "snapshots", name), { recursive: true });
  await writeFile(path.join(runDir, "snapshots", "00001_a", "dom.html"), "");
  await writeFile(path.join(runDir, "snapshots", "00002_b", "dom.html"), dom);
  const calls = [];
  const runJson = async (args, opts) => (calls.push({ args, opts }), { data, stderr: `run_dir: ${runDir}\n` });
  return { runDir, calls, search: createTiktokSnapshotSearch({ runJson }) };
}

const gone = (p) => stat(p).then(() => false, () => true);

test("a timeout with a rendered page is recovered from the last snapshot, then snapshots are deleted", async () => {
  const { runDir, calls, search } = await fakeRun(timeout);
  const data = await search("football ai", 8);
  assert.deepEqual(calls[0].args.slice(-2), ["--pretty", "--debug-snapshot"]);
  assert.equal(calls[0].opts.full, true);
  assert.equal(data.ok, true);
  assert.equal(data.cards.length, 3);
  assert.equal(data.recovered, "the page snapshot");
  assert.ok(await gone(path.join(runDir, "snapshots")));
});

test("a real success or another failure passes through untouched, snapshots still deleted", async () => {
  for (const data of [{ ok: true, cards: [{ url: "u" }] }, { ok: false, reason: "login_required", cards: [] }]) {
    const { runDir, search } = await fakeRun(data);
    assert.deepEqual(await search("q", 8), data);
    assert.ok(await gone(path.join(runDir, "snapshots")));
  }
});
