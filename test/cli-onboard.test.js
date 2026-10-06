import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const forbidFetchHook = new URL("../test-support/forbid-fetch.js", import.meta.url);

test("non-interactive onboard subprocess does not attempt socai CLI installation without --install", () => {
  const directory = mkdtempSync(join(tmpdir(), "jev-social-subprocess-"));
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", forbidFetchHook.href, "bin/jev-social.js", "onboard", "--no-verify"],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          JEV_SOCIAL_HOME: directory,
          SOCAI_BIN: join(directory, "missing-socai"),
          OPENROUTER_API_KEY: String(104),
        },
        input: "",
      },
    );

    assert.equal(result.status, 0, `Expected exit status 0, stderr: ${result.stderr}`);
    assert.match(result.stdout, /socai CLI: not ready/u);
    assert.doesNotMatch(result.stdout, /Downloading official installer/u);
    assert.doesNotMatch(result.stdout, /socai CLI was not found/u);
    assert.equal(result.stderr, "");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
