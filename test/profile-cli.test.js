import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const binPath = fileURLToPath(new URL("../bin/jev-social.js", import.meta.url));

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [binPath, ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH },
    });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    return { code: error.status, stdout: error.stdout, stderr: error.stderr };
  }
}

test("bare `reports` (no subcommand) fails with a usage message, without touching profile deps", () => {
  const result = run(["reports"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Usage: jev-social reports rebuild\|import\|classify/);
});

test("`reports` with an unknown subcommand fails with the same usage message", () => {
  const result = run(["reports", "bogus"]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Usage: jev-social reports rebuild\|import\|classify/);
});

function descriptionColumn(line) {
  let column = -1;
  let index = 0;
  while (index < line.length) {
    if (line[index] === " ") {
      let end = index;
      while (end < line.length && line[end] === " ") end += 1;
      if (end - index >= 2 && end < line.length) column = end;
      index = end;
    } else {
      index += 1;
    }
  }
  return column;
}

test("HELP aligns the profile line's description column with its neighbours", async () => {
  const source = await readFile(new URL("../bin/jev-social.js", import.meta.url), "utf8");
  const helpLines = source.match(/^ {2}jev-social[^\n]*$/gm) || [];
  assert.ok(helpLines.length >= 5, "expected several `jev-social ...` usage lines");
  const columns = new Set(helpLines.map(descriptionColumn));
  assert.equal(columns.size, 1, `expected one shared description column, got ${[...columns].join(", ")}`);
});
