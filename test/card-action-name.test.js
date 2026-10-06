import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function productionFunction(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(`\nfunction ${nextName}(`, start);
  assert.notEqual(start, -1, `expected production function ${name}`);
  assert.notEqual(end, -1, `expected production function ${nextName} after ${name}`);
  return appSource.slice(start, end).trim();
}

function element(tagName, className = "", text = "") {
  return {
    tagName,
    className,
    text,
    attributes: {},
    children: [],
    append(...children) {
      this.children.push(...children);
    },
    addEventListener() {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

function descendants(node) {
  return [node, ...(node.children || []).flatMap(descendants)];
}

function makeRenderer() {
  return vm.runInNewContext(
    `(() => {
      ${productionFunction("accessibleEvidenceContext", "renderCard")}
      ${productionFunction("renderCard", "renderMediaPreview")}
      return renderCard;
    })()`,
    {
      element,
      renderMediaPreview() {},
      renderStats: () => null,
      showDetail() {},
      firstString(item, keys) {
        return keys.map((key) => item[key]).find((value) => typeof value === "string" && value.trim()) || "";
      },
      authorName: (item) => item.author || "",
      isHttpUrl: (value) => /^https:\/\//u.test(value || ""),
      Array,
      Intl,
      String,
    },
  );
}

function actions(card) {
  const nodes = descendants(card);
  return {
    button: nodes.find((node) => node.tagName === "button"),
    link: nodes.find((node) => node.tagName === "a"),
  };
}

test("renderCard gives repeated actions bounded, record-specific accessible names", () => {
  const renderCard = makeRenderer();
  const first = actions(renderCard({ title: "Duplicate title", url: "https://example.com/one" }, 0));
  const second = actions(renderCard({ title: "Duplicate title", url: "https://example.com/two" }, 1));

  assert.equal(first.button.text, "View details");
  assert.equal(first.link.text, "Open source ↗");
  assert.equal(first.button.attributes["aria-label"], "View details for evidence 1: Duplicate title");
  assert.equal(first.link.attributes["aria-label"], "Open source ↗ for evidence 1: Duplicate title");
  assert.notEqual(first.button.attributes["aria-label"], second.button.attributes["aria-label"]);
  assert.notEqual(first.link.attributes["aria-label"], second.link.attributes["aria-label"]);

  const missingTitle = actions(renderCard({ author: "@maker", url: "https://example.com/three" }, 2));
  assert.equal(missingTitle.button.attributes["aria-label"], "View details for evidence 3: @maker");

  const longTitle = actions(renderCard({ title: "x".repeat(200), url: "https://example.com/four" }, 3));
  assert.match(longTitle.button.attributes["aria-label"], /…$/u);
  assert.ok(longTitle.button.attributes["aria-label"].length <= 80);

  const sensitiveTitle = actions(renderCard({
    title: "https://private.example/post /Users/alice/run.json",
    url: "https://example.com/five",
  }, 4));
  assert.equal(sensitiveTitle.button.attributes["aria-label"], "View details for evidence 5: Result 5");
  assert.doesNotMatch(sensitiveTitle.link.attributes["aria-label"], /private\.example|\/Users\//u);

  const spacedPath = actions(renderCard({
    title: "Saved at C:\\Users\\Alice Smith\\private\\run.json",
    url: "https://example.com/six",
  }, 5));
  assert.equal(spacedPath.button.attributes["aria-label"], "View details for evidence 6: Result 6");
  assert.doesNotMatch(spacedPath.link.attributes["aria-label"], /Alice|private|run\.json/u);

  const emojiTitle = actions(renderCard({ title: "👩‍💻".repeat(40), url: "https://example.com/seven" }, 6));
  const emojiLabel = emojiTitle.link.attributes["aria-label"];
  const emojiContext = emojiLabel.replace(/^Open source ↗ for evidence 7: /u, "");
  assert.ok(emojiLabel.length <= 80);
  assert.match(emojiContext, /^(?:👩‍💻)*…$/u, "truncation must preserve complete grapheme clusters");
});
