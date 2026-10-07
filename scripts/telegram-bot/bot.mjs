#!/usr/bin/env node
// jev-bot — Telegram front-end for jev-social on a headless host.
//
// /profile <url|@handle> <niche> queues a `jev-social profile` collection; jobs run one at a
// time (GUIDE rule: a single socai collection at a time), `socai stop` runs after each, and the
// bot replies with a summary + dashboard link. Long-polling getUpdates: no public endpoint.
// Restricted to the chat IDs in TELEGRAM_CHAT_ID (comma/space separated). Logic: core.mjs.
//
// Credentials: an env file ($JEV_BOT_ENV_FILE, default /etc/notify/channels/jev.env) with
// TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID; process env TELEGRAM_BOT_TOKEN is the fallback.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBot, createSqliteStore, runProcess } from "./core.mjs";

const HOME = homedir();
const JEV_DIR = process.env.JEV_SOCIAL_DIR || resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DB_PATH = process.env.JEV_SOCIAL_DB || join(HOME, ".jev-social", "jev-social.db");
const SOCAI = process.env.SOCAI_BIN || join(HOME, ".local", "bin", "socai");

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

const childEnv = {
  ...process.env,
  DISPLAY: process.env.DISPLAY || ":99",
  SOCAI_TELEMETRY: "off",
  SOCAI_BIN: SOCAI,
  PATH: `${join(HOME, ".local", "bin")}:${process.env.PATH || "/usr/bin:/bin"}`,
};

const bot = createBot({
  send: (chat, text) => api("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
  run: (cmd, args, { timeoutMs }) => runProcess(cmd, args, { cwd: JEV_DIR, env: childEnv, timeoutMs }),
  store: createSqliteStore(DB_PATH),
  config: {
    allowed: ALLOWED,
    dashboard: process.env.JEV_DASHBOARD_URL || "http://localhost:5173",
    socaiBin: SOCAI,
    nodeBin: process.execPath,
    jobTimeoutMs: Number(process.env.JEV_BOT_JOB_TIMEOUT_MS || 15 * 60 * 1000),
    stopTimeoutMs: 30_000,
  },
});

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
    if (u.message) bot.handleMessage(u.message).catch((e) => console.error(`[jev-bot] handler: ${e.stack || e.message}`));
  }
}
