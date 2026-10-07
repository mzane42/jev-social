import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createBot, runProcess } from "../scripts/telegram-bot/core.mjs";

const CHAT = 111;

function harness({ run, store = {} } = {}) {
  const sent = [];
  const calls = [];
  const logs = [];
  const bot = createBot({
    send: async (chat, text) => sent.push({ chat, text }),
    run: async (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return run ? run(cmd, args, opts) : { code: 0, stdout: "", stderr: "" };
    },
    store: { latestReport: () => null, niches: () => [], last: () => [], ...store },
    config: {
      allowed: new Set([String(CHAT)]),
      dashboard: "https://dash.example:8090/",
      socaiBin: "/opt/socai",
      nodeBin: "/opt/node",
      jobTimeoutMs: 60_000,
      stopTimeoutMs: 5_000,
    },
    log: (line) => logs.push(line),
    now: () => 0,
  });
  return { bot, sent, calls, logs };
}

const reportPath = (niche, account) => path.join("/home/u/.jev-social/reports", niche, account, "2026-10-07", "report.html");

test("bot ignores chats outside the allowlist and never runs anything for them", async () => {
  const { bot, sent, calls } = harness();
  await bot.handleMessage({ chat: { id: 999 }, text: "/profile @someone cuisine" });
  assert.deepEqual(sent, [{ chat: 999, text: "⛔ Not authorized." }]);
  assert.equal(calls.length, 0);
});

test("bot rejects malformed /profile arguments without spawning", async () => {
  const { bot, sent, calls } = harness();
  for (const text of ["/profile", "/profile @ok", "/profile @ok Bad_Niche", "/profile $(id) cuisine", "/profile https://evil.example/@x cuisine"]) {
    await bot.handleMessage({ chat: { id: CHAT }, text });
  }
  assert.equal(calls.length, 0);
  assert.ok(sent.every((m) => m.text.startsWith("Usage: /profile")));
});

test("bot runs collections one at a time in order, stopping socai after each", async () => {
  const order = [];
  const { bot, sent, calls } = harness({
    run: async (cmd, args) => {
      order.push(cmd === "/opt/socai" ? "stop" : `profile ${args[2]}`);
      if (cmd === "/opt/socai") return { code: 0, stdout: "", stderr: "" };
      await new Promise((ok) => setTimeout(ok, 10));
      return { code: 0, stdout: `${reportPath("cuisine", `tiktok@${args[2].slice(1)}`)}\n`, stderr: "" };
    },
  });
  await bot.handleMessage({ chat: { id: CHAT }, text: "/profile @first cuisine" });
  await bot.handleMessage({ chat: { id: CHAT }, text: "/profile @second cuisine" });
  await bot.drain();

  assert.deepEqual(order, ["profile @first", "stop", "profile @second", "stop"]);
  assert.deepEqual(calls[0].args, ["bin/jev-social.js", "profile", "@first", "--niche", "cuisine"]);
  assert.equal(calls[0].opts.timeoutMs, 60_000);
  assert.equal(calls[1].opts.timeoutMs, 5_000);
  assert.ok(sent.some((m) => m.text === "🕒 En file (1 avant)."));
});

test("bot replies with a summary and dashboard link on success", async () => {
  const { bot, sent } = harness({
    run: async (cmd) =>
      cmd === "/opt/socai"
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 0, stdout: `${reportPath("football-anime", "tiktok@azuran.studio")}\n`, stderr: "" },
    store: {
      latestReport: (niche, account) => {
        assert.equal(niche, "football-anime");
        assert.equal(account, "tiktok@azuran.studio");
        return { date: "2026-10-07", data: { snapshot: { items: [1, 2, 3] }, metrics: { medianViews: 545400, viewsPerFollower: 2.85 }, insights: [1, 2] } };
      },
    },
  });
  await bot.handleMessage({ chat: { id: CHAT }, text: "/profile @azuran.studio football-anime" });
  await bot.drain();

  const summary = sent.at(-1).text;
  assert.match(summary, /✅ <b>tiktok@azuran\.studio<\/b>/);
  assert.match(summary, /3 vidéos/);
  assert.match(summary, /2 insights/);
  assert.ok(summary.includes('href="https://dash.example:8090/n/football-anime/a/tiktok%40azuran.studio"'));
});

test("bot failure replies never echo CLI output or local paths", async () => {
  const { bot, sent, logs } = harness({
    run: async (cmd) =>
      cmd === "/opt/socai"
        ? { code: 0, stdout: "", stderr: "" }
        : { code: 1, stdout: "", stderr: "Error: boom at /home/u/www/jev-social/src/app.js:12\nSOCAI_BIN=/home/u/.local/bin/socai" },
  });
  await bot.handleMessage({ chat: { id: CHAT }, text: "/profile @x cuisine" });
  await bot.drain();

  const reply = sent.at(-1).text;
  assert.match(reply, /^❌ Échec <b>@x<\/b> — la collecte a échoué/);
  assert.doesNotMatch(reply, /\/home\/|SOCAI_BIN|app\.js|boom/);
  assert.ok(logs.some((line) => line.includes("boom")), "details stay in the host log");
});

test("bot reports a timeout distinctly and a failed socai stop does not block the queue", async () => {
  const { bot, sent, logs } = harness({
    run: async (cmd) =>
      cmd === "/opt/socai"
        ? { code: null, stdout: "", stderr: "", timedOut: true }
        : { code: null, signal: "SIGTERM", stdout: "", stderr: "", timedOut: true },
  });
  await bot.handleMessage({ chat: { id: CHAT }, text: "/profile @slow cuisine" });
  await bot.handleMessage({ chat: { id: CHAT }, text: "/profile @next cuisine" });
  await bot.drain();

  const failures = sent.filter((m) => m.text.startsWith("❌"));
  assert.equal(failures.length, 2);
  assert.match(failures[0].text, /délai dépassé \(1 min\)/);
  assert.ok(logs.some((line) => line.includes("socai stop failed: timeout")));
});

test("runProcess settles on spawn errors instead of throwing", async () => {
  const res = await runProcess("/nonexistent/jev-bot-binary", []);
  assert.equal(res.code, null);
  assert.equal(res.error?.code, "ENOENT");
  assert.equal(res.timedOut, false);
});

test("runProcess kills a process that outlives its timeout", async () => {
  const started = Date.now();
  const res = await runProcess(process.execPath, ["-e", "setTimeout(() => {}, 30_000)"], { timeoutMs: 100, killGraceMs: 200 });
  assert.equal(res.timedOut, true);
  assert.equal(res.signal, "SIGTERM");
  assert.ok(Date.now() - started < 5_000);
});

test("runProcess escalates to SIGKILL when SIGTERM is ignored", async () => {
  const res = await runProcess(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setTimeout(() => {}, 30_000)"], { timeoutMs: 100, killGraceMs: 200 });
  assert.equal(res.timedOut, true);
  assert.equal(res.signal, "SIGKILL");
});
