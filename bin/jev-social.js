#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
import readline from "node:readline/promises";
import { runSearch } from "../src/app.js";
import { getConfigPath, readConfig, resolveApiKey } from "../src/config.js";
import { resolveDecisionProvider } from "../src/decision-provider.js";
import { loadLocalEnv } from "../src/env.js";
import { saveOnboarding, resolveSocaiInstallDecision } from "../src/onboard.js";
import { probeSocai } from "../src/socai.js";
import { startServer } from "../src/server.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { discover } from "../src/discover.js";
import { validateNiche, validateRange } from "../src/profile/domain.js";
import { analyzeMedia, analyzeProfile, classifyReports, rebuildIndexes } from "../src/profile/analyze.js";
import { createFsRepository, reportsRoot } from "../src/profile/adapters/fs-repository.js";
import { renderNicheIndex, renderReport, renderRootIndex } from "../src/profile/adapters/html-renderer.js";
import { createJevClassifier, loadDeck } from "../src/profile/adapters/jev-classifier.js";
import { createLocalMedia } from "../src/profile/adapters/media.js";
import { createOpenRouterInsights } from "../src/profile/adapters/openrouter-insights.js";
import { createSocaiCollector, createSocaiRunJson } from "../src/profile/adapters/socai-collector.js";
import { withYtdlpFallback } from "../src/profile/adapters/ytdlp-fallback.js";

const HELP = `jev-social — Jev-directed social research through socai CLI

Usage:
  jev-social                                      Start local preview
  jev-social --version                            Show installed version
  jev-social onboard [options]                    Optional manual configuration
  jev-social status                               Show local readiness
  jev-social search <query> [options]             Run one search
  jev-social serve [--port 8766] [--no-open]      Start local preview
  jev-social profile <url> --niche <slug>         Analyse a TikTok/Instagram profile; <url> may be a bare @handle
  jev-social discover --niche <slug>              Find same-niche accounts from niches/<slug>.json keywords and seeds
  jev-social reports rebuild                      Regenerate report index pages
  jev-social reports import [dir...]              Load saved data.json reports into the local database
  jev-social reports classify [--niche <slug>]    Jev-classify saved videos (theme, format, news hook)
  jev-social media <niche> [--top 5 --flops 3]    Download top/flop TikTok videos, frames, local transcript, hook
  jev-social media <niche> --rehook               Re-read hooks from saved frames (no download)
  jev-social radar [--max 40] [--no-jev]          Story radar: RSS news, cast match, Jev scoring
  jev-social shop collect --niche <slug>          TikTok Shop watch [--dry-run]: searches, product anchors, day file

Search options:
  --platform <auto|instagram|tiktok|linkedin>  Platform hint (default: auto)
  --limit <1-100>                      Result limit (default: 10)
  --max-steps <1-30>                   Decision budget (default: 12)

Profile options:
  --niche <slug>                       Niche folder, e.g. football-anime (required)
  --videos <1-50>                      Items to collect (default: 12)
  --deep <0-10>                        Top items read with comments (default: 3)
  Reports go to $JEV_SOCIAL_REPORTS_DIR or ~/.jev-social/reports

Discover options:
  --per-keyword <1-50>                 Results per keyword and search (default: 8)
  --hashtags <0-20>                    Seed hashtags reused as keywords (default: 5)
  --platform <auto|tiktok|instagram>   Search one platform only (default: auto = both)

Configuration (normally auto-loaded from .env):
  --api-key <key>                      OpenRouter API key (prompt is safer)
  --socai-bin <path>                   socai executable override
  --install                            Install/reinstall official socai CLI (required for unattended install)
  --skip-install                       Do not offer CLI installation
  --no-verify                          Save API key without a network check

Local decision provider (environment only):
  JEV_SOCIAL_SYSTEM_ONE_URL            Loopback /v1/systemone endpoint
  JEV_SOCIAL_SYSTEM_ONE_MODEL          Model name (default: kev-latest)
  JEV_SOCIAL_SYSTEM_ONE_TIMEOUT_MS     Timeout in ms (default/max: 120000)
`;

try {
  const [command = "serve", ...rest] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) {
    console.log(HELP);
  } else if (["version", "--version", "-v"].includes(command)) {
    let packageJson;
    try {
      packageJson = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      );
    } catch {
      throw new Error("Could not read Jev Social version.");
    }
    console.log(packageJson.version);
  } else if (command === "serve") {
    await loadLocalEnv();
    const flags = parseArgs(rest);
    await startServer({ port: flags.port || 8766, open: !flags.noOpen });
  } else if (command === "status") {
    await loadLocalEnv();
    const config = await readConfig();
    const provider = resolveDecisionProvider();
    console.log(
      JSON.stringify(
        {
          jevConfigured: provider.kind === "local" || Boolean(resolveApiKey(config)),
          jevModel: provider.model,
          decisionProvider: provider.kind,
          configPath: getConfigPath(),
          socai: await probeSocai(config, process.env, undefined, { includeReadiness: true }),
        },
        null,
        2,
      ),
    );
  } else if (command === "onboard") {
    await loadLocalEnv();
    await onboard(parseArgs(rest));
  } else if (command === "search") {
    await loadLocalEnv();
    const flags = parseArgs(rest);
    const query = flags._.join(" ").trim();
    const run = await runSearch(
      { query, platform: flags.platform || "auto", limit: Number(flags.limit ?? 10), maxSteps: Number(flags.maxSteps ?? 12) },
      {
        onEvent(event) {
          if (event.message) console.error(`[${event.stage}] ${event.message}`);
        },
      },
    );
    console.log(JSON.stringify(run, null, 2));
  } else if (command === "profile") {
    await loadLocalEnv();
    const flags = parseArgs(rest);
    // SIGTERM aborts the run so the detached socai process tree is stopped, not orphaned.
    const controller = new AbortController();
    const onSigterm = () => controller.abort();
    process.once("SIGTERM", onSigterm);
    try {
      const deps = await profileDeps();
      const result = await analyzeProfile(deps, {
        url: flags._[0],
        niche: flags.niche,
        videos: Number(flags.videos ?? 12),
        deep: Number(flags.deep ?? 3),
        signal: controller.signal,
      });
      if (result.snapshot.fallbackFrom) console.error(`Not found, fell back: ${result.snapshot.fallbackFrom}`);
      if (result.snapshot.partial) console.error(`Partial capture: ${result.snapshot.partialReason}`);
      if (result.classification.skipped) console.error(result.classification.skipped);
      else if (result.classification.classified) console.error(`Jev classified ${result.classification.classified} videos`);
      console.log(path.join(result.dir, "report.html"));
    } finally {
      process.off("SIGTERM", onSigterm);
    }
  } else if (command === "media") {
    const flags = parseArgs(rest);
    const niche = validateNiche(flags._[0]);
    const deps = await profileDeps();
    const result = await analyzeMedia(deps, {
      niche,
      top: validateRange("--top", Number(flags.top ?? 5), 0, 20),
      flops: validateRange("--flops", Number(flags.flops ?? 3), 0, 20),
      rehook: Boolean(flags.rehook),
      log: (line) => console.error(line),
    });
    for (const note of result.notes) console.error(note);
    console.log(`${result.processed} videos analysed, ${result.classified} re-classified with transcripts`);
  } else if (command === "discover") {
    const flags = parseArgs(rest);
    const deps = await profileDeps();
    validateNiche(flags.niche);
    const niche = JSON.parse(await readFile(new URL(`../niches/${flags.niche}.json`, import.meta.url), "utf8").catch(() => "null"));
    if (!niche) throw new Error(`niches/${flags.niche}.json not found.`);
    const result = await discover(
      { collector: deps.collector, runJson: createSocaiRunJson({ config: await readConfig() }) },
      {
        slug: flags.niche,
        niche,
        perKeyword: Number(flags.perKeyword ?? 8),
        hashtags: Number(flags.hashtags ?? 5),
        platforms: flags.platform && flags.platform !== "auto" ? [flags.platform] : undefined,
        onNote: (note) => console.error(`[discover] ${note}`),
      },
    );
    deps.repository.saveCandidates(flags.niche, result.candidates);
    console.error(`Queries: ${result.queries.join(", ")}`);
    for (const c of result.candidates) console.log(`${String(c.score).padStart(3)}  ${c.account.padEnd(40)} ${c.signals.join(", ")}`);
    console.error(`${result.candidates.length} candidates → ${deps.dbPath}`);
  } else if (command === "radar") {
    const flags = parseArgs(rest);
    const niche = validateNiche(flags.niche ?? "football-anime");
    const deck = { niche, ...JSON.parse(await readFile(new URL(`../niches/${niche}.json`, import.meta.url), "utf8")) };
    const { databasePath, openDatabase } = await import("../src/profile/adapters/sqlite-repository.js");
    const { runRadar } = await import("../src/radar.js");
    const apiKey = resolveApiKey(await readConfig());
    const provider = resolveDecisionProvider();
    const jev = !flags.noJev && (provider.kind === "local" || Boolean(apiKey));
    if (!jev && !flags.noJev) console.error("Jev is not configured: items are fetched but not scored.");
    const result = await runRadar({
      db: openDatabase(databasePath()), deck, provider, apiKey, jev,
      max: validateRange("--max", Number(flags.max ?? 40), 0, 200),
      log: (line) => console.error(line),
    });
    console.log(`${result.fresh} fresh items from ${result.feeds} feeds, ${result.castMatched} mention the cast, ${result.scored} scored by Jev`);
  } else if (command === "shop") {
    const sub = rest[0];
    const flags = parseArgs(rest.slice(1));
    const niche = flags.niche ? validateNiche(flags.niche) : null;
    const deck = niche ? JSON.parse(await readFile(new URL(`../niches/${niche}.json`, import.meta.url), "utf8")) : null;
    if (sub !== "collect" || !niche) {
      console.error("Usage: jev-social shop collect --niche <slug> [--dry-run]");
      process.exitCode = 1;
    } else if (!deck.shop) {
      console.error(`niches/${niche}.json has no "shop" key.`);
      process.exitCode = 1;
    } else {
      const { databasePath, openDatabase } = await import("../src/profile/adapters/sqlite-repository.js");
      const { createShopStore } = await import("../src/shop-store.js");
      const { collectShop } = await import("../src/shop.js");
      const { socaiBusy } = await import("../src/shop-guard.js");
      const { runProcess } = await import("../src/process.js");
      const { resolveSocaiBin } = await import("../src/socai.js");
      const home = process.env.JEV_SOCIAL_HOME || path.join(process.env.HOME, ".jev-social");
      const runsDir = path.join(process.env.SOCAI_HOME || path.join(process.env.HOME, ".socai"), "runs");
      const busy = flags.dryRun ? null : await socaiBusy({ runsDir });
      if (busy) {
        console.error(`${busy}, skipped.`);
      } else {
        const config = await readConfig();
        const runJson = createSocaiRunJson({ config });
        const store = createShopStore(openDatabase(databasePath()));
        let result;
        try {
          const cfg = flags.cap ? { ...deck.shop, dailyCap: validateRange("--cap", Number(flags.cap), 1, 1000) } : deck.shop;
          result = await collectShop({ runJson, store, cfg, niche, outDir: path.join(home, "shop"), dryRun: Boolean(flags.dryRun), log: (line) => console.error(line) });
        } finally {
          if (!flags.dryRun) {
            const bin = await resolveSocaiBin(config, process.env);
            await runProcess(bin, ["stop"], { timeoutMs: 30_000, env: { ...process.env, SOCAI_TELEMETRY: "0", SOCAI_NO_UPDATE_CHECK: "1" } }).catch(() => {});
          }
        }
        if (flags.dryRun) {
          for (const q of result.planned) console.log(`${q.mode.padEnd(8)} ${q.query.padEnd(24)} socai ${q.args.join(" ")}`);
        } else {
          console.log(`shop ${result.date}: ${result.cards} cards, ${result.detailed} detailed (${result.refreshed} refreshed), ${result.products} products, ${result.creators} creators, ${result.discovered.length} new sellers, ${result.errors.length} errors, ${result.skipped} left for tomorrow`);
          for (const error of result.errors) console.error(`  ! ${error}`);
          console.log(result.file);
        }
      }
    }
  } else if (command === "reports") {
    if (!["rebuild", "import", "classify"].includes(rest[0])) throw new Error("Usage: jev-social reports rebuild|import|classify");
    const deps = await profileDeps();
    if (rest[0] === "import") {
      // ponytail: imports the latest report per account only; history stays in the folders.
      let count = 0;
      for (const root of rest.length > 1 ? rest.slice(1) : [reportsRoot()]) {
        for (const entry of await createFsRepository({ root }).listLatest()) {
          deps.repository.importReport(entry.data);
          const html = await readFile(path.join(root, entry.niche, entry.account, entry.date, "report.html"), "utf8").catch(() => null);
          if (html !== null) await deps.repository.writeIndex(path.join(entry.niche, entry.account, entry.date, "report.html"), html);
          count += 1;
        }
      }
      console.log(`${count} reports imported → ${deps.dbPath}`);
    } else if (rest[0] === "classify") {
      const flags = parseArgs(rest.slice(1));
      if (!deps.classifier) throw new Error("Jev is not configured: set OPENROUTER_API_KEY or JEV_SOCIAL_SYSTEM_ONE_URL.");
      const { classified, notes } = await classifyReports(deps, { niche: flags.niche });
      for (const note of notes) console.error(note);
      console.log(`${classified} videos classified`);
    } else {
      const counts = await rebuildIndexes(deps);
      console.log(`${counts.niches} niches, ${counts.accounts} accounts → ${path.join(reportsRoot(), "index.html")}`);
    }
  } else {
    throw new Error(`Unknown command: ${command}\n\n${HELP}`);
  }
} catch (error) {
  console.error(`jev-social: ${error.message}`);
  if (error.details) console.error(JSON.stringify(error.details, null, 2));
  process.exitCode = 1;
}

async function profileDeps() {
  const config = await readConfig();
  const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  // node:sqlite needs Node 22.13+; loaded here so the other commands keep running on Node 20.
  const { createSqliteRepository, databasePath, openDatabase } = await import("../src/profile/adapters/sqlite-repository.js");
  const apiKey = resolveApiKey(config);
  const provider = resolveDecisionProvider();
  return {
    version,
    collector: withYtdlpFallback(createSocaiCollector({ runJson: createSocaiRunJson({ config }) })),
    insights: createOpenRouterInsights({
      apiKey,
      model: String(process.env.OPENROUTER_REPORT_MODEL || "openai/gpt-4o-mini").trim(),
    }),
    dbPath: databasePath(),
    repository: createSqliteRepository({ db: openDatabase(databasePath()), files: createFsRepository({ root: reportsRoot() }) }),
    classifier: provider.kind === "local" || apiKey ? createJevClassifier({ apiKey, provider }) : null,
    loadDeck,
    media: createLocalMedia({
      runJson: createSocaiRunJson({ config }),
      apiKey,
      ...(process.env.OPENROUTER_HOOK_MODEL ? { hookModel: process.env.OPENROUTER_HOOK_MODEL.trim() } : {}),
    }),
    render: { report: renderReport, nicheIndex: renderNicheIndex, rootIndex: renderRootIndex },
  };
}

async function onboard(flags) {
  const current = await readConfig();
  const provider = resolveDecisionProvider();
  let apiKey;
  let persistApiKey = false;
  if (flags.apiKey) {
    apiKey = flags.apiKey;
    persistApiKey = true;
  } else if (resolveApiKey(current)) {
    apiKey = resolveApiKey(current);
  }
  if (!apiKey && provider.kind === "openrouter") {
    apiKey = await promptSecret("OpenRouter API key: ");
    persistApiKey = true;
  }

  const proposed = { ...current, ...(flags.socaiBin ? { socaiBin: flags.socaiBin } : {}) };
  const before = await probeSocai(proposed);
  let installCli = resolveSocaiInstallDecision({
    installed: before.installed,
    install: flags.install,
    skipInstall: flags.skipInstall,
    isTTY: stdin.isTTY,
  });
  if (!before.installed && !flags.skipInstall && !flags.install && stdin.isTTY) {
    const userChoice = await promptYesNo("socai CLI was not found. Install the official release now?", true);
    installCli = resolveSocaiInstallDecision({
      installed: before.installed,
      install: userChoice,
      skipInstall: !userChoice,
      isTTY: stdin.isTTY,
    });
  }

  console.log("Checking setup…");
  const result = await saveOnboarding({
    apiKey,
    socaiBin: flags.socaiBin,
    installCli,
    verify: !flags.noVerify,
    persistApiKey,
    onMessage: (message) => console.log(message),
  });
  console.log(`Saved ${result.configPath}`);
  console.log(
    result.decisionProvider.kind === "local"
      ? `Decision provider: local (${result.decisionProvider.model})`
      : `Jev API: ${flags.noVerify ? "saved (not verified)" : "verified"}`,
  );
  console.log(`socai CLI: ${result.socai.installed ? result.socai.bin : "not ready"}`);
  if (result.socai.capabilities) {
    console.log(`Capabilities: ${JSON.stringify(result.socai.capabilities)}`);
  }
}

function parseArgs(args) {
  const result = { _: [] };
  const booleanFlags = new Map([
    ["--no-open", "noOpen"],
    ["--skip-install", "skipInstall"],
    ["--install", "install"],
    ["--rehook", "rehook"],
    ["--no-verify", "noVerify"],
    ["--no-jev", "noJev"],
    ["--dry-run", "dryRun"],
  ]);
  const valueFlags = new Map([
    ["--platform", "platform"],
    ["--limit", "limit"],
    ["--max-steps", "maxSteps"],
    ["--port", "port"],
    ["--api-key", "apiKey"],
    ["--socai-bin", "socaiBin"],
    ["--niche", "niche"],
    ["--videos", "videos"],
    ["--deep", "deep"],
    ["--top", "top"],
    ["--flops", "flops"],
    ["--per-keyword", "perKeyword"],
    ["--hashtags", "hashtags"],
    ["--max", "max"],
    ["--cap", "cap"],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (booleanFlags.has(token)) {
      result[booleanFlags.get(token)] = true;
    } else if (valueFlags.has(token)) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} requires a value.`);
      result[valueFlags.get(token)] = value;
      index += 1;
    } else if (token.startsWith("--")) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      result._.push(token);
    }
  }
  return result;
}

async function promptYesNo(question, defaultYes) {
  if (!stdin.isTTY) return false;
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"} `)).trim().toLowerCase();
    if (!answer) return defaultYes;
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function promptSecret(label) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Set OPENROUTER_API_KEY when onboarding without an interactive terminal.");
  }
  return new Promise((resolve, reject) => {
    let value = "";
    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const onData = (character) => {
      if (character === "\u0003") {
        cleanup();
        stdout.write("\n");
        reject(new Error("Onboarding cancelled."));
      } else if (character === "\r" || character === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(value);
      } else if (character === "\u007f" || character === "\b") {
        if (value) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
      } else if (character >= " ") {
        value += character;
        stdout.write("•");
      }
    };
    stdin.on("data", onData);
  });
}
