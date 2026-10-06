import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

function productionFunction(name, nextName) {
  const start = appSource.indexOf(`function ${name}(`);
  const end = appSource.indexOf(`\nfunction ${nextName}(`, start);
  assert.notEqual(start, -1, `expected production function ${name}`);
  assert.notEqual(end, -1, `expected production function ${nextName} after ${name}`);
  return appSource.slice(start, end).trim();
}

function renderPreview(title, { candidates = [{ kind: "remote-video", src: "https://media.example/video.mp4" }], ...options } = {}) {
  const created = [];
  const frameClasses = new Set();
  const frame = {
    children: [],
    classList: {
      toggle(name, enabled) {
        if (enabled) frameClasses.add(name);
        else frameClasses.delete(name);
      },
    },
    replaceChildren(...children) {
      this.children = children;
    },
  };
  const renderer = vm.runInNewContext(
    `(() => {
      ${productionFunction("renderMediaPreview", "renderMediaFallback")}
      ${productionFunction("renderMediaFallback", "posterSources")}
      return renderMediaPreview;
    })()`,
    {
      document: {
        createElement(tagName) {
          const node = {
            tagName,
            attributes: {},
            listeners: {},
            addEventListener(name, listener) {
              this.listeners[name] = listener;
            },
            dispatch(name) {
              this.listeners[name]?.();
            },
            setAttribute(name, value) {
              this.attributes[name] = String(value);
            },
          };
          created.push(node);
          return node;
        },
      },
      element: (tagName, className, text) => ({
        tagName,
        className,
        text,
        children: [],
        append(...children) {
          this.children.push(...children);
        },
      }),
      nextPreviewCandidate: (_item, failed) => candidates.find((candidate) => (
        candidate.kind === "fallback" || !failed.has(candidate.src)
      )) ?? { kind: "fallback" },
      posterSource: () => "https://media.example/poster.jpg",
      capitalize: (value) => value.charAt(0).toUpperCase() + value.slice(1),
    },
  );

  renderer(frame, {}, { title, ...options });
  return { created, frame, frameClasses };
}

test("card and detail video previews keep equivalent record-specific accessible names", () => {
  assert.match(
    appSource,
    /const title = firstString\([\s\S]{0,240}renderMediaPreview\(frame, item, \{ title \}\)/,
    "renderCard must pass its visible evidence title into the production media renderer",
  );
  assert.match(
    appSource,
    /renderMediaPreview\(media, item, \{ showBadge: false, title \}\)/,
    "showDetail must pass the same evidence title into the production media renderer",
  );

  const card = renderPreview("Ceramic studio tour");
  const detail = renderPreview("Ceramic studio tour", { showBadge: false });
  const other = renderPreview("City market interview");
  const cardVideo = card.created.find((node) => node.tagName === "video");
  const detailVideo = detail.created.find((node) => node.tagName === "video");
  const otherVideo = other.created.find((node) => node.tagName === "video");

  assert.equal(cardVideo.attributes["aria-label"], "Video preview for Ceramic studio tour");
  assert.equal(detailVideo.attributes["aria-label"], cardVideo.attributes["aria-label"]);
  assert.equal(otherVideo.attributes["aria-label"], "Video preview for City market interview");
  assert.notEqual(otherVideo.attributes["aria-label"], cardVideo.attributes["aria-label"]);
});

test("video errors preserve decorative images and the existing fallback copy", () => {
  const preview = renderPreview("Ceramic studio tour", {
    candidates: [
      { kind: "remote-video", src: "https://media.example/video.mp4" },
      { kind: "image", src: "https://media.example/poster.jpg" },
      { kind: "fallback" },
    ],
  });
  const video = preview.created.find((node) => node.tagName === "video");

  video.dispatch("error");
  const image = preview.created.find((node) => node.tagName === "img");
  assert.equal(image.alt, "", "image previews must remain decorative");
  assert.equal(preview.frame.children[0], image);

  image.dispatch("error");
  assert.ok(preview.frameClasses.has("media-frame-fallback"));
  assert.equal(preview.frame.children[0].className, "media-fallback");
  assert.equal(
    preview.frame.children[0].children[2].text,
    "Preview unavailable — post details are still preserved.",
  );
});
