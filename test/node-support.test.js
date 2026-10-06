import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("runtime metadata and CI use supported Node LTS releases", async () => {
  const [nvmrc, packageJson, packageLock, workflow, skill] = await Promise.all([
    readFile(new URL(".nvmrc", root), "utf8"),
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("package-lock.json", root), "utf8").then(JSON.parse),
    readFile(new URL(".github/workflows/test.yml", root), "utf8"),
    readFile(new URL("skills/jev-social/SKILL.md", root), "utf8"),
  ]);

  assert.equal(nvmrc.trim(), "24");
  assert.equal(packageJson.engines?.node, ">=22");
  assert.equal(packageLock.packages?.[""]?.engines?.node, packageJson.engines.node);
  assert.match(workflow, /node-version:\s*\[22, 24\]/u);
  assert.match(workflow, /node-version:\s*\$\{\{ matrix\.node-version \}\}/u);

  const runtimePins = [
    ...skill.matchAll(/github:socai-io\/jev-social#([a-f0-9]{40})/gu),
  ].map((match) => match[1]);
  assert.equal(new Set(runtimePins).size, 1);
  const pinnedPackage = JSON.parse(
    execFileSync("git", ["show", `${runtimePins[0]}:package.json`], {
      cwd: new URL(".", root),
      encoding: "utf8",
    }),
  );
  const pinnedMinimum = Number(/^>=(\d+)$/u.exec(pinnedPackage.engines?.node)?.[1]);
  assert.ok(
    Number.isInteger(pinnedMinimum) && pinnedMinimum <= 22,
    "the immutable Skill runtime must accept the supported Node 22 floor",
  );
});

test("maintainer and public setup text no longer recommends EOL Node 20", async () => {
  const paths = [
    "AGENTS.md",
    "CONTRIBUTING.md",
    "README.md",
    "6w.json",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    "skills/jev-social/SKILL.md",
    "site/llms.txt",
    "site/privacy/index.html",
    "site/social-research/index.html",
  ];
  const documents = await Promise.all(
    paths.map(async (path) => [path, await readFile(new URL(path, root), "utf8")]),
  );

  for (const [path, contents] of documents) {
    assert.doesNotMatch(contents, /\bNode(?:\.js)? 20(?:\+|\b)/u, path);
  }
});
