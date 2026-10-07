import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { startServer } from "../src/server.js";
import { readLatestShopDay, renderShopPage } from "../src/shop-page.js";

test("renderShopPage escapes content and lists videos by views with their product", () => {
  const html = renderShopPage({
    date: "2026-10-07", niche: "x", modes: 1, runAt: "t", creators: [], discovered: [], errors: [],
    products: [{ productId: "1", title: "Tapis <b>lapin</b>", shortTitle: "Tapis", url: "https://www.tiktok.com/view/product/1", categories: ["Maison"], skuCount: 3, sellerId: "9" }],
    videos: [
      { url: "https://www.tiktok.com/@a/video/1", handle: "a", isEc: true, productIds: ["1"], stats: { views: 10 }, mode: "tag", query: "maison", caption: "petit" },
      { url: "https://www.tiktok.com/@b/video/2", handle: "b", isEc: false, productIds: [], stats: { views: 5000 }, mode: "global", query: "g", caption: "<script>x</script>" },
    ],
  });
  assert.match(html, /Tapis &lt;b&gt;lapin&lt;\/b&gt;/);
  assert.ok(!html.includes("<script>"));
  assert.ok(html.indexOf("@b") < html.indexOf("@a"), "sorted by views desc");
  assert.match(html, /<td>Tapis<\/td>/);
});

test("GET /shop serves the latest day file, or a hint when none exists", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "jev-social-shop-"));
  const env = { ...process.env, JEV_SOCIAL_HOME: home };
  const { server, url } = await startServer({ port: 0, open: false, env });
  try {
    assert.match(await (await fetch(`${url}/shop`)).text(), /Aucune collecte/);
    await mkdir(path.join(home, "shop"));
    await writeFile(path.join(home, "shop", "2026-10-06.json"), JSON.stringify({ date: "2026-10-06", products: [{ productId: "1", title: "Vieux" }], videos: [] }));
    await writeFile(path.join(home, "shop", "2026-10-07.json"), JSON.stringify({ date: "2026-10-07", products: [{ productId: "2", title: "Neuf" }], videos: [] }));
    const response = await fetch(`${url}/shop`);
    assert.match(response.headers.get("content-type"), /^text\/html/);
    const html = await response.text();
    assert.match(html, /Neuf/);
    assert.ok(!html.includes("Vieux"));
    assert.equal(await readLatestShopDay(path.join(home, "nope")), null);
  } finally {
    server.close();
  }
});
