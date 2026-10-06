import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../.github/workflows/codeql.yml", import.meta.url),
  "utf8",
);

test("CodeQL init and analyze use one immutable v4 release", () => {
  const actions = [
    ...workflow.matchAll(
      /github\/codeql-action\/(init|analyze)@([a-f0-9]{40}) # v(4\.\d+\.\d+)/g,
    ),
  ];

  assert.deepEqual(
    actions.map((match) => match[1]),
    ["init", "analyze"],
  );
  assert.equal(new Set(actions.map((match) => match[2])).size, 1);
  assert.equal(new Set(actions.map((match) => match[3])).size, 1);
});
