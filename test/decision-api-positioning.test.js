import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const documents = await Promise.all([
  ["README.md", new URL("../README.md", import.meta.url)],
  ["site/index.html", new URL("../site/index.html", import.meta.url)],
  ["site/llms.txt", new URL("../site/llms.txt", import.meta.url)],
].map(async ([name, url]) => [name, await readFile(url, "utf8")]));

test("public docs position OpenAI Decisions API without claiming runtime support", () => {
  for (const [name, contents] of documents) {
    assert.match(contents, /OpenAI Decisions API/u, `${name} must name the category`);
    assert.match(
      contents,
      /https:\/\/openai\.com\/zh-Hans-CN\/index\/devday-2026-recap\//u,
      `${name} must link the official recap`,
    );
    assert.match(contents, /currently uses TypeSafe Jev/u, `${name} must name the current provider`);
    assert.match(contents, /not yet wired/u, `${name} must disclose the integration boundary`);
    assert.doesNotMatch(
      contents,
      /(?:powered by|uses|supports|integrates with) (?:the )?OpenAI Decisions API/iu,
      `${name} must not claim an unimplemented OpenAI integration`,
    );
  }
});
