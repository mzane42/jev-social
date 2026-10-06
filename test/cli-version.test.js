import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = new URL("../", import.meta.url);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const readFailureHook = new URL("../test-support/version-read-failure.js", import.meta.url);

for (const flag of ["--version", "-v"]) {
  test(`${flag} prints the package version without reading local configuration`, () => {
    const unreadableAsFile = mkdtempSync(join(tmpdir(), "jev-social-version-"));
    try {
      const result = spawnSync(process.execPath, ["bin/jev-social.js", flag], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          JEV_SOCIAL_ENV_FILE: unreadableAsFile,
        },
      });

      assert.equal(result.status, 0);
      assert.equal(result.stdout, `${packageJson.version}\n`);
      assert.equal(result.stderr, "");
    } finally {
      rmSync(unreadableAsFile, { recursive: true, force: true });
    }
  });
}

test("version metadata failures do not expose an installation path", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", readFailureHook.href, "bin/jev-social.js", "--version"],
    { cwd: root, encoding: "utf8" },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "jev-social: Could not read Jev Social version.\n");
  assert.doesNotMatch(result.stderr, /private|package\.json|node:fs/u);
});
