#!/usr/bin/env node
// jev-bot — Telegram front-end for jev-social on the VPS.
//
// /profile <url|@handle> <niche> queues a `jev-social profile` collection; jobs run one at a
// time (GUIDE rule: a single socai collection at a time), `socai stop` runs after each, and the
// bot replies with a summary + dashboard link. Long-polling getUpdates: no public endpoint.
// Restricted to the chat IDs in TELEGRAM_CHAT_ID (comma/space separated).
//
// Credentials: an env file ($JEV_BOT_ENV_FILE, default /etc/notify/channels/jev.env) with
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; process env TELEGRAM_BOT_TOKEN is the fallback.

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const HOME = homedir();
const JEV_DIR = process.env.JEV_SOCIAL_DIR || resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DB_PATH = process.env.JEV_SOCIAL_DB || join(HOME, ".jev-social", "jev-social.db");
const SOCAI = process.env.SOCAI_BIN || join(HOME, ".local", "bin", "socai");
const DASHBOARD = (process.env.JEV_DASHBOARD_URL || "http://localhost:5173").replace(/\/$/, "");
const JOB_TIMEOUT_MS = Number(process.env.JEV_BOT_JOB_TIMEOUT_MS || 15 * 60 * 1000);
const NICHE = /^[a-z0-9-]{1,48}$/;
const TARGET = /^(?:@?[A-Za-z0-9._]{1,64}|https:\/\/(?:www\.)?(?:tiktok|instagram)\.com\/\S{1,120})$/;

function loadEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  try {
    for (const raw of readFileSync(path, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(?:"([^"]*)"|(.*))$/);
      if (m) out[m[1]] = (m[2] !== undefined ? m[2] : m[3]).trim();
    }
  } catch { /* ignore */ }
  return out;
}

const CFG = loadEnvFile(process.env.JEV_BOT_ENV_FILE || "/etc/notify/channels/jev.env");
const TOKEN = (CFG.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || "").trim();
if (!TOKEN) { console.error("[jev-bot] no bot token"); process.exit(2); }
const API = `https://api.telegram.org/bot${TOKEN}`;
const ALLOWED = new Set(String(CFG.TELEGRAM_CHAT_ID || "").split(/[\s,]+/).filter(Boolean));
if (!ALLOWED.size) { console.error("[jev-bot] TELEGRAM_CHAT_ID is empty: refusing to run open to everyone"); process.exit(2); }

async function api(method, body) {
  try {
    const r = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const j = await r.json().catch(() => ({}));
    if (j && j.ok === false) console.error(`[jev-bot] ${method} failed: ${j.error_code} ${j.description}`);
    return j;
  } catch (e) {
    console.error(`[jev-bot] ${method} error: ${e.message}`);
    return { ok: false };
  }
}
const send = (chat, text) =>
  api("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true });
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const fmt = (n) => (Number.isFinite(n) ? new Intl.NumberFormat("fr-FR", { notation: "compact" }).format(n) : "—");

// ── DB (read-only) ──────────────────────────────────────────────────────────
function withDb(fn) {
  let db;
  try {
    db = new DatabaseSync(DB_PATH, { readOnly: true });
    return fn(db);
  } catch (e) {
    console.error(`[jev-bot] db: ${e.message}`);
    return null;
  } finally {
    db?.close();
  }
}

function latestReport(niche, account) {
  return withDb((db) => {
    const row = db.prepare("SELECT date, data FROM reports WHERE niche = ? AND account = ? ORDER BY date DESC LIMIT 1").get(niche, account);
    return row ? { date: row.date, data: JSON.parse(String(row.data)) } : null;
  });
}

function dashboardLink(niche, account) {
  return `${DASHBOARD}/n/${encodeURIComponent(niche)}/a/${encodeURIComponent(account)}`;
}

// ── Job queue: one collection at a time ─────────────────────────────────────
const queue = [];
let current = null;

function run(cmd, args, { timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: JEV_DIR,
      env: {
        ...process.env,
        DISPLAY: process.env.DISPLAY || ":99",
        SOCAI_TELEMETRY: "off",
        SOCAI_BIN: SOCAI,
        PATH: `${join(HOME, ".local", "bin")}:${process.env.PATH || "/usr/bin:/bin"}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = timeoutMs ? setTimeout(() => child.kill("SIGTERM"), timeoutMs) : null;
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function runJob(job) {
  const started = Date.now();
  await send(job.chat, `⏳ Collecte <b>${esc(job.target)}</b> · niche <code>${esc(job.niche)}</code>…`);
  const res = await run(process.execPath, ["bin/jev-social.js", "profile", job.target, "--niche", job.niche], { timeoutMs: JOB_TIMEOUT_MS });
  await run(SOCAI, ["stop"]);
  const secs = Math.round((Date.now() - started) / 1000);

  // Last stdout line is …/reports/<niche>/<account>/<date>/report.html
  const reportPath = res.stdout.trim().split("\n").pop() || "";
  const parts = reportPath.split(sep);
  const account = res.code === 0 && parts.length >= 4 ? parts[parts.length - 3] : null;
  if (!account) {
    const why = res.signal ? `interrompue (${res.signal}, timeout ${Math.round(JOB_TIMEOUT_MS / 60000)} min)` : `code ${res.code}`;
    const tail = (res.stderr || res.stdout).trim().split("\n").slice(-4).join("\n");
    await send(job.chat, `❌ Échec <b>${esc(job.target)}</b> — ${why} après ${secs}s\n<pre>${esc(tail.slice(-800))}</pre>`);
    return;
  }

  const report = latestReport(job.niche, account);
  const snap = report?.data?.snapshot || {};
  const metrics = report?.data?.metrics || {};
  const lines = [
    `✅ <b>${esc(account)}</b> · <code>${esc(job.niche)}</code> (${secs}s)`,
    `🎬 ${snap.items?.length ?? "?"} vidéos${snap.partial ? ` · ⚠️ partiel: ${esc(snap.partialReason || "")}` : ""}`,
    `👁 médiane ${fmt(metrics.medianViews)} vues · ${Number.isFinite(metrics.viewsPerFollower) ? metrics.viewsPerFollower.toFixed(2) : "—"} vues/abonné`,
    `💡 ${report?.data?.insights?.length ?? 0} insights${report?.data?.insightNotice ? ` (${esc(report.data.insightNotice)})` : ""}`,
    `📊 <a href="${dashboardLink(job.niche, account)}">Ouvrir dans le dashboard</a>`,
  ];
  const stderrNotes = res.stderr.trim().split("\n").filter((l) => /fell back|Partial capture|classified|disabled/i.test(l));
  if (stderrNotes.length) lines.push(`<i>${esc(stderrNotes.join(" · ").slice(0, 300))}</i>`);
  await send(job.chat, lines.join("\n"));
}

async function pump() {
  if (current || !queue.length) return;
  current = queue.shift();
  try {
    await runJob(current);
  } catch (e) {
    console.error(`[jev-bot] job error: ${e.stack || e.message}`);
    await send(current.chat, `❌ Erreur interne: ${esc(e.message)}`);
  } finally {
    current = null;
    void pump();
  }
}

// ── Commands ────────────────────────────────────────────────────────────────
const HELP =
  "🎯 <b>jev-social</b>\n\n" +
  "/profile <code>&lt;@handle|url&gt; &lt;niche&gt;</code> — collecte + rapport (un @handle seul essaie TikTok puis Instagram)\n" +
  "/niches — niches connues\n" +
  "/last — 5 derniers rapports\n" +
  "/queue — collecte en cours / en attente\n" +
  `📊 Dashboard: ${DASHBOARD}`;

function niches() {
  return withDb((db) => db.prepare("SELECT niche, COUNT(DISTINCT account) AS n, MAX(date) AS last FROM reports GROUP BY niche ORDER BY last DESC").all()) || [];
}

async function handleMessage(msg) {
  const chat = msg.chat?.id;
  if (!chat) return;
  if (!ALLOWED.has(String(chat))) {
    await send(chat, "⛔ Not authorized.");
    console.error(`[jev-bot] rejected chat ${chat}`);
    return;
  }
  const [rawCmd, ...args] = (msg.text || "").trim().split(/\s+/);
  const cmd = (rawCmd || "").replace(/@\w+$/, "").toLowerCase();

  if (cmd === "/start" || cmd === "/help") return send(chat, HELP);

  if (cmd === "/profile") {
    const [target, niche] = args;
    if (!target || !niche || !TARGET.test(target) || !NICHE.test(niche)) {
      return send(chat, "Usage: /profile <code>@handle</code> <code>niche</code>\nex: <code>/profile @azuran.studio football-anime</code>");
    }
    queue.push({ chat, target, niche });
    const ahead = queue.length - 1 + (current ? 1 : 0);
    if (ahead) await send(chat, `🕒 En file (${ahead} avant).`);
    return pump();
  }

  if (cmd === "/niches") {
    const rows = niches();
    if (!rows.length) return send(chat, "Aucune niche en base.");
    return send(chat, rows.map((r) => `• <a href="${DASHBOARD}/n/${encodeURIComponent(r.niche)}">${esc(r.niche)}</a> — ${r.n} comptes · ${esc(r.last)}`).join("\n"));
  }

  if (cmd === "/last") {
    const rows = withDb((db) => db.prepare("SELECT niche, account, date FROM reports ORDER BY COALESCE(captured_at, date) DESC LIMIT 5").all()) || [];
    if (!rows.length) return send(chat, "Aucun rapport.");
    return send(chat, rows.map((r) => `• <a href="${dashboardLink(r.niche, r.account)}">${esc(r.account)}</a> · ${esc(r.niche)} · ${esc(r.date)}`).join("\n"));
  }

  if (cmd === "/queue") {
    if (!current && !queue.length) return send(chat, "Rien en cours.");
    const lines = [];
    if (current) lines.push(`▶️ ${esc(current.target)} · ${esc(current.niche)}`);
    for (const j of queue) lines.push(`🕒 ${esc(j.target)} · ${esc(j.niche)}`);
    return send(chat, lines.join("\n"));
  }

  if (cmd.startsWith("/")) return send(chat, HELP);
}

// ── Long-poll loop ──────────────────────────────────────────────────────────
await api("setMyCommands", {
  commands: [
    { command: "profile", description: "Collecte: /profile @handle niche" },
    { command: "niches", description: "Niches connues" },
    { command: "last", description: "Derniers rapports" },
    { command: "queue", description: "Collecte en cours" },
    { command: "help", description: "Aide" },
  ],
});
console.error(`[jev-bot] up; allowed chats: ${[...ALLOWED].join(",")}`);

let offset = 0;
for (;;) {
  const r = await api("getUpdates", { offset, timeout: 50, allowed_updates: ["message"] });
  if (!r.ok) { await new Promise((ok) => setTimeout(ok, 5000)); continue; }
  for (const u of r.result || []) {
    offset = u.update_id + 1;
    if (u.message) handleMessage(u.message).catch((e) => console.error(`[jev-bot] handler: ${e.stack || e.message}`));
  }
}
