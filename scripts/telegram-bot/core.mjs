// Telegram bot logic, free of I/O wiring so it can be tested offline.
// bot.mjs injects the Telegram client (`send`), the process runner (`run`) and the store.

import { spawn } from "node:child_process";
import { sep } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const NICHE = /^[a-z0-9-]{1,48}$/;
export const TARGET = /^(?:@?[A-Za-z0-9._]{1,64}|https:\/\/(?:www\.)?(?:tiktok|instagram)\.com\/\S{1,120})$/;

export const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const fmt = (n) => (Number.isFinite(n) ? new Intl.NumberFormat("fr-FR", { notation: "compact" }).format(n) : "—");

/**
 * Runs a command without a shell. Always resolves: { code, signal, stdout, stderr, timedOut, error }.
 * On timeout it sends SIGTERM, then SIGKILL after killGraceMs.
 */
export function runProcess(cmd, args, { cwd, env, timeoutMs = 0, killGraceMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      resolve({ code: null, signal: null, stdout: "", stderr: "", timedOut: false, error });
      return;
    }
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceTimer = null;
    let settled = false;
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          forceTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
        }, timeoutMs)
      : null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      resolve({ stdout, stderr, timedOut, ...result });
    };
    child.on("error", (error) => finish({ code: null, signal: null, error }));
    child.on("close", (code, signal) => finish({ code, signal, error: null }));
  });
}

/** Read-only queries over the jev-social SQLite store; every call opens and closes the DB. */
export function createSqliteStore(dbPath, { log = console.error } = {}) {
  const withDb = (fn) => {
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      return fn(db);
    } catch (e) {
      log(`[jev-bot] db: ${e.message}`);
      return null;
    } finally {
      db?.close();
    }
  };
  return {
    latestReport(niche, account) {
      return withDb((db) => {
        const row = db.prepare("SELECT date, data FROM reports WHERE niche = ? AND account = ? ORDER BY date DESC LIMIT 1").get(niche, account);
        return row ? { date: row.date, data: JSON.parse(String(row.data)) } : null;
      });
    },
    niches() {
      return withDb((db) => db.prepare("SELECT niche, COUNT(DISTINCT account) AS n, MAX(date) AS last FROM reports GROUP BY niche ORDER BY last DESC").all()) || [];
    },
    last(limit = 5) {
      return withDb((db) => db.prepare("SELECT niche, account, date FROM reports ORDER BY COALESCE(captured_at, date) DESC LIMIT ?").all(limit)) || [];
    },
  };
}

/**
 * @param {object} deps
 * @param {(chat: number|string, html: string) => Promise<unknown>} deps.send
 * @param {(cmd: string, args: string[], opts: { timeoutMs: number }) => Promise<object>} deps.run
 * @param {{ latestReport: Function, niches: Function, last: Function }} deps.store
 * @param {{ allowed: Set<string>, dashboard: string, socaiBin: string, nodeBin: string,
 *           jobTimeoutMs: number, stopTimeoutMs: number }} deps.config
 */
export function createBot({ send, run, store, config, log = console.error, now = Date.now }) {
  const dashboard = config.dashboard.replace(/\/$/, "");
  const accountLink = (niche, account) => `${dashboard}/n/${encodeURIComponent(niche)}/a/${encodeURIComponent(account)}`;
  const queue = [];
  let current = null;
  let drained = Promise.resolve();
  let markDrained = () => {};

  const help =
    "🎯 <b>jev-social</b>\n\n" +
    "/profile <code>&lt;@handle|url&gt; &lt;niche&gt;</code> — collecte + rapport (un @handle seul essaie TikTok puis Instagram)\n" +
    "/niches — niches connues\n" +
    "/last — 5 derniers rapports\n" +
    "/queue — collecte en cours / en attente\n" +
    `📊 Dashboard: ${dashboard}`;

  async function runJob(job) {
    const started = now();
    await send(job.chat, `⏳ Collecte <b>${esc(job.target)}</b> · niche <code>${esc(job.niche)}</code>…`);
    const res = await run(config.nodeBin, ["bin/jev-social.js", "profile", job.target, "--niche", job.niche], { timeoutMs: config.jobTimeoutMs });
    // Bounded so a stalled stop cannot block the queue; its outcome never changes the job result.
    const stop = await run(config.socaiBin, ["stop"], { timeoutMs: config.stopTimeoutMs });
    if (stop.error || stop.timedOut || stop.code !== 0) {
      log(`[jev-bot] socai stop failed: ${stop.error?.message || (stop.timedOut ? "timeout" : `code ${stop.code}`)}`);
    }
    const secs = Math.round((now() - started) / 1000);

    // Last stdout line is …/reports/<niche>/<account>/<date>/report.html
    const parts = (res.stdout || "").trim().split("\n").pop().split(sep);
    const account = res.code === 0 && parts.length >= 4 ? parts[parts.length - 3] : null;
    if (!account) {
      // Details (stack traces, local paths) stay in the host log, never in the chat.
      log(`[jev-bot] profile ${job.target} ${job.niche} failed: ${res.error?.message || ""} code=${res.code} signal=${res.signal} timedOut=${res.timedOut}\n${res.stderr || res.stdout || ""}`);
      const why = res.timedOut
        ? `délai dépassé (${Math.round(config.jobTimeoutMs / 60000)} min)`
        : res.error ? "impossible de lancer la collecte" : "la collecte a échoué";
      await send(job.chat, `❌ Échec <b>${esc(job.target)}</b> — ${why} après ${secs}s. Détails dans les logs du VPS.`);
      return;
    }

    const report = store.latestReport(job.niche, account);
    const snap = report?.data?.snapshot || {};
    const metrics = report?.data?.metrics || {};
    const lines = [
      `✅ <b>${esc(account)}</b> · <code>${esc(job.niche)}</code> (${secs}s)`,
      `🎬 ${snap.items?.length ?? "?"} vidéos${snap.partial ? " · ⚠️ capture partielle" : ""}`,
      `👁 médiane ${fmt(metrics.medianViews)} vues · ${Number.isFinite(metrics.viewsPerFollower) ? metrics.viewsPerFollower.toFixed(2) : "—"} vues/abonné`,
      `💡 ${report?.data?.insights?.length ?? 0} insights`,
      `📊 <a href="${accountLink(job.niche, account)}">Ouvrir dans le dashboard</a>`,
    ];
    await send(job.chat, lines.join("\n"));
  }

  async function pump() {
    if (current || !queue.length) return;
    current = queue.shift();
    try {
      await runJob(current);
    } catch (e) {
      log(`[jev-bot] job error: ${e.stack || e.message}`);
      await send(current.chat, "❌ Erreur interne. Détails dans les logs du VPS.");
    } finally {
      current = null;
      if (queue.length) void pump();
      else markDrained();
    }
  }

  async function handleMessage(msg) {
    const chat = msg.chat?.id;
    if (!chat) return;
    if (!config.allowed.has(String(chat))) {
      log(`[jev-bot] rejected chat ${chat}`);
      return send(chat, "⛔ Not authorized.");
    }
    const [rawCmd, ...args] = (msg.text || "").trim().split(/\s+/);
    const cmd = (rawCmd || "").replace(/@\w+$/, "").toLowerCase();

    if (cmd === "/start" || cmd === "/help") return send(chat, help);

    if (cmd === "/profile") {
      const [target, niche] = args;
      if (!target || !niche || !TARGET.test(target) || !NICHE.test(niche)) {
        return send(chat, "Usage: /profile <code>@handle</code> <code>niche</code>\nex: <code>/profile @azuran.studio football-anime</code>");
      }
      if (!current && !queue.length) drained = new Promise((ok) => { markDrained = ok; });
      queue.push({ chat, target, niche });
      const ahead = queue.length - 1 + (current ? 1 : 0);
      if (ahead) await send(chat, `🕒 En file (${ahead} avant).`);
      void pump();
      return;
    }

    if (cmd === "/niches") {
      const rows = store.niches();
      if (!rows.length) return send(chat, "Aucune niche en base.");
      return send(chat, rows.map((r) => `• <a href="${dashboard}/n/${encodeURIComponent(r.niche)}">${esc(r.niche)}</a> — ${r.n} comptes · ${esc(r.last)}`).join("\n"));
    }

    if (cmd === "/last") {
      const rows = store.last(5);
      if (!rows.length) return send(chat, "Aucun rapport.");
      return send(chat, rows.map((r) => `• <a href="${accountLink(r.niche, r.account)}">${esc(r.account)}</a> · ${esc(r.niche)} · ${esc(r.date)}`).join("\n"));
    }

    if (cmd === "/queue") {
      if (!current && !queue.length) return send(chat, "Rien en cours.");
      const lines = [];
      if (current) lines.push(`▶️ ${esc(current.target)} · ${esc(current.niche)}`);
      for (const j of queue) lines.push(`🕒 ${esc(j.target)} · ${esc(j.niche)}`);
      return send(chat, lines.join("\n"));
    }

    if (cmd.startsWith("/")) return send(chat, help);
  }

  return { handleMessage, drain: () => drained };
}
