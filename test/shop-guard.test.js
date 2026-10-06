import assert from "node:assert/strict";
import { mkdir, mkdtemp, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { socaiBusy } from "../src/shop-guard.js";

const now = () => new Date("2026-10-07T07:30:00.000Z");

test("busy when a collection process runs", async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), "runs-"));
  assert.match(await socaiBusy({ runsDir, now, pgrep: async () => "123 socai tiktok search" }), /process/);
});

test("busy when a run directory is younger than 10 minutes, free otherwise", async () => {
  const runsDir = await mkdtemp(path.join(tmpdir(), "runs-"));
  const fresh = path.join(runsDir, "20261007_072500_tiktok_search");
  await mkdir(fresh);
  await utimes(fresh, new Date("2026-10-07T07:25:00.000Z"), new Date("2026-10-07T07:25:00.000Z"));
  assert.match(await socaiBusy({ runsDir, now, pgrep: async () => "" }), /run/);
  await utimes(fresh, new Date("2026-10-07T07:00:00.000Z"), new Date("2026-10-07T07:00:00.000Z"));
  assert.equal(await socaiBusy({ runsDir, now, pgrep: async () => "" }), null);
});

test("a missing runs directory counts as free", async () => {
  assert.equal(await socaiBusy({ runsDir: path.join(tmpdir(), "does-not-exist"), now, pgrep: async () => "" }), null);
});
