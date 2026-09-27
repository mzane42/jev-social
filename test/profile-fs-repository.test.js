import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { mock } from "node:test";
import { createFsRepository, reportsRoot } from "../src/profile/adapters/fs-repository.js";

const snapshotAt = (capturedAt, handle = "demo_creator") => ({
  platform: "tiktok", handle, niche: "football-anime", url: `https://www.tiktok.com/@${handle}`, capturedAt,
  partial: false, partialReason: null, profile: { followers: 1 }, items: [],
});

test("reportsRoot honours JEV_SOCIAL_REPORTS_DIR then JEV_SOCIAL_HOME", () => {
  assert.equal(reportsRoot({ JEV_SOCIAL_REPORTS_DIR: "/tmp/r" }), path.resolve("/tmp/r"));
  assert.equal(reportsRoot({ JEV_SOCIAL_HOME: "/tmp/h" }), path.resolve("/tmp/h/reports"));
});

test("save writes report.html and data.json privately under niche/account/date", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jev-reports-"));
  try {
    const repository = createFsRepository({ root });
    const { dir } = await repository.save({ snapshot: snapshotAt("2026-09-27T18:00:00.000Z"), metrics: {}, insights: [], insightNotice: null, html: "<p>x</p>" });
    assert.equal(dir, path.join(root, "football-anime", "tiktok@demo_creator", "2026-09-27"));
    assert.equal(await readFile(path.join(dir, "report.html"), "utf8"), "<p>x</p>");
    assert.equal(JSON.parse(await readFile(path.join(dir, "data.json"), "utf8")).snapshot.handle, "demo_creator");
    if (process.platform !== "win32") {
      assert.equal((await stat(path.join(dir, "data.json"))).mode & 0o777, 0o600);
      assert.equal((await stat(dir)).mode & 0o777, 0o700);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a trailing slash on root resolves to the same base as a clean path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jev-reports-"));
  try {
    const clean = createFsRepository({ root });
    const trailing = createFsRepository({ root: `${root}${path.sep}` });
    const { dir: dirA } = await clean.save({ snapshot: snapshotAt("2026-09-27T00:00:00Z", "a"), metrics: {}, insights: [], html: "" });
    const { dir: dirB } = await trailing.save({ snapshot: snapshotAt("2026-09-20T00:00:00Z", "a"), metrics: {}, insights: [], html: "" });
    assert.equal(path.dirname(dirA), path.dirname(dirB));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("save refuses paths that escape the root", async () => {
  const repository = createFsRepository({ root: "/tmp/jev-root" });
  await assert.rejects(
    repository.save({ snapshot: { ...snapshotAt("2026-09-27T00:00:00Z"), niche: "../x" }, metrics: {}, insights: [], html: "" }),
    { code: "INVALID_PROFILE_INPUT" },
  );
});

test("listLatest returns the newest date per account and writeIndex writes relative files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jev-reports-"));
  try {
    const repository = createFsRepository({ root });
    for (const [capturedAt, handle] of [["2026-09-20T00:00:00Z", "a"], ["2026-09-27T00:00:00Z", "a"], ["2026-09-21T00:00:00Z", "b"]]) {
      await repository.save({ snapshot: snapshotAt(capturedAt, handle), metrics: {}, insights: [], html: "" });
    }
    const latest = await repository.listLatest();
    assert.deepEqual(latest.map(({ niche, account, date, href }) => ({ niche, account, date, href })), [
      { niche: "football-anime", account: "tiktok@a", date: "2026-09-27", href: "tiktok@a/2026-09-27/report.html" },
      { niche: "football-anime", account: "tiktok@b", date: "2026-09-21", href: "tiktok@b/2026-09-21/report.html" },
    ]);
    assert.equal(latest[0].data.snapshot.handle, "a");
    const written = await repository.writeIndex("football-anime/index.html", "<p>i</p>");
    assert.equal(await readFile(written, "utf8"), "<p>i</p>");
    assert.deepEqual(await createFsRepository({ root: path.join(root, "missing") }).listLatest(), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("listLatest skips a corrupt data.json instead of throwing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "jev-reports-"));
  try {
    const repository = createFsRepository({ root });
    await repository.save({ snapshot: snapshotAt("2026-09-27T00:00:00Z", "good"), metrics: {}, insights: [], html: "" });
    const corruptDir = path.join(root, "football-anime", "tiktok@bad", "2026-09-27");
    await mkdir(corruptDir, { recursive: true });
    await writeFile(path.join(corruptDir, "data.json"), "{not json", "utf8");

    const errorMock = mock.method(console, "error", () => {});
    try {
      const latest = await repository.listLatest();
      assert.deepEqual(latest.map(({ account }) => account), ["tiktok@good"]);
      assert.equal(errorMock.mock.calls.length, 1);
      assert.equal(errorMock.mock.calls[0].arguments[0], path.join("football-anime", "tiktok@bad", "2026-09-27", "data.json"));
    } finally {
      errorMock.mock.restore();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
