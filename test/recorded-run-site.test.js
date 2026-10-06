import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const [page, script, styles, landing, sitemap, llms, workflow, report, readme] = await Promise.all([
  readFile(new URL("../site/recorded-run/index.html", import.meta.url), "utf8"),
  readFile(new URL("../site/recorded-run/replay.js", import.meta.url), "utf8"),
  readFile(new URL("../site/recorded-run/replay.css", import.meta.url), "utf8"),
  readFile(new URL("../site/index.html", import.meta.url), "utf8"),
  readFile(new URL("../site/sitemap.xml", import.meta.url), "utf8"),
  readFile(new URL("../site/llms.txt", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
  readFile(new URL("../docs/example-report.md", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8"),
]);

function cardFor(id) {
  const match = page.match(new RegExp(`<article\\b[^>]*data-record-id=["']${id}["'][^>]*>[\\s\\S]*?<\\/article>`, "i"));
  assert.ok(match, `expected a card for ${id}`);
  return match[0];
}

test("the public replay is explicit about being recorded and non-live", () => {
  assert.match(page, /sanitized replay of one preserved local run/i);
  assert.match(page, /does not contact Instagram, control Chrome, or make a live socai request/i);
  assert.match(page, /one recorded run, not a benchmark/i);
  assert.match(page, /September 18, 2026/i);
  assert.match(page, /63\.969 seconds/i);
  assert.doesNotMatch(page, /\b(?:www\.)?(?:instagram|tiktok|linkedin)\.com\b/i);
  assert.doesNotMatch(page, /@[a-z\d._]+/i);
  assert.doesNotMatch(page, /\/Users\/|[A-Z]:\\\\/i);
  assert.doesNotMatch(page, /\b(?:github\.com\/)?socai-io\/socai\b/i);
  assert.doesNotMatch(page, /\b(?:www\.)?socai\.io\b/i);
  assert.doesNotMatch(
    page,
    /Aman Sanger|Maor Shlomo|Mira Murati|Thomas Guthrie|Cursor|Anysphere|Base44|Thinking Machines|Runwise|TechCrunch|Wall Street Journal/i,
  );
  assert.doesNotMatch(page, /\b(?:18,000|250K|15-year-old)\b|\$(?:189K|80M|12B)/i);
});

test("the replay preserves all four evidence states without overstating coverage", () => {
  assert.equal((page.match(/data-evidence-card\b/g) ?? []).length, 4);
  assert.match(cardFor("E01"), /opened post/i);
  for (const id of ["E02", "E03", "E04"]) assert.match(cardFor(id), /discovery only/i);
  assert.match(page, /record-to-query mapping was not retained/i);
  assert.match(page, /final stopping rationale (?:was|were) not retained/i);
  assert.match(page, /No comment or reply text was captured/i);
  assert.match(page, /canonical source withheld/i);
});

test("the replay stays bound to the canonical sanitized report", () => {
  for (const fact of [
    "find ai founders on instagram",
    "AI founder",
    "AI startup founder",
    "63.969 seconds",
  ]) {
    assert.ok(report.toLowerCase().includes(fact.toLowerCase()), `report must retain ${fact}`);
    assert.ok(page.toLowerCase().includes(fact.toLowerCase()), `replay must retain ${fact}`);
  }

  assert.match(report, /Two searches; one post-detail read/i);
  assert.match(page, /2 searches \+ 1 detail read/i);
  assert.match(page, /PRESERVED RUN CONTRACT/);
  assert.doesNotMatch(page, /RECORDED OPERATIONS/);
  assert.doesNotMatch(page, />\s*Route the goal\s*</i);
  assert.doesNotMatch(page, />\s*Finish\s*</i);
});

test("the replay progressively reveals evidence and remains accessible", () => {
  assert.match(page, /aria-live=["']polite["']/i);
  assert.match(page, /data-replay-step=["']\d+["']/i);
  assert.match(page, /Replay the recorded run/i);
  assert.match(script, /prefers-reduced-motion:\s*reduce/i);
  assert.match(script, /setTimeout\s*\(/);
  assert.match(script, /revealStep/);
  assert.match(script, /setAttribute\(["']aria-hidden["'],\s*["']true["']\)/);
  assert.match(script, /\.inert\s*=\s*true/);
  assert.match(script, /removeAttribute\(["']aria-hidden["']\)/);
  assert.match(script, /\.inert\s*=\s*false/);
  assert.match(script, /function finishReplay\(\)[\s\S]*Recorded replay complete/);
  assert.match(script, /if \(step === phases\.at\(-1\)\) finishReplay\(\)/);
  assert.doesNotMatch(script, /requestAnimationFrame\s*\(\s*playReplay/);
  assert.doesNotMatch(script, /fetch\s*\(/);
  assert.doesNotMatch(script, /WebSocket/i);
  assert.match(styles, /\[data-replay-step\]/);
  assert.match(styles, /\.is-visible/);

  const scriptPath = fileURLToPath(new URL("../site/recorded-run/replay.js", import.meta.url));
  execFileSync(process.execPath, ["--check", scriptPath], {
    stdio: "pipe",
  });
});

test("the public site exposes and deploys the recorded run", () => {
  assert.match(landing, /href=["']\.\/recorded-run\/["']/i);
  assert.match(
    readme,
    /\[Watch the recorded run\]\(https:\/\/socai-io\.github\.io\/jev-social\/recorded-run\/\)/,
  );
  assert.match(sitemap, /https:\/\/socai-io\.github\.io\/jev-social\/recorded-run\//);
  assert.match(
    sitemap,
    /<loc>https:\/\/socai-io\.github\.io\/jev-social\/<\/loc>\s*<lastmod>2026-09-29<\/lastmod>/,
  );
  assert.match(llms, /Recorded run replay:\s*https:\/\/socai-io\.github\.io\/jev-social\/recorded-run\//i);
  assert.match(workflow, /mkdir -p[^\n]*_site\/recorded-run/);
  assert.match(
    workflow,
    /cp site\/recorded-run\/index\.html site\/recorded-run\/replay\.css site\/recorded-run\/replay\.js _site\/recorded-run\//,
  );
});

test("the replay offers clear local-run and source actions", () => {
  assert.match(page, /href=["']\.\.\/#run["'][^>]*>\s*Run it locally/i);
  assert.match(page, /href=["']https:\/\/github\.com\/socai-io\/jev-social["']/i);
  assert.match(page, />\s*Star on GitHub/i);
  assert.match(page, /href=["']https:\/\/github\.com\/socai-io\/jev-social\/blob\/main\/docs\/example-report\.md["']/i);
});
