#!/usr/bin/env node

import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runSearch } from "../src/app.js";
import { getConfigPath, readConfig, resolveApiKey } from "../src/config.js";
import { resolveDecisionProvider } from "../src/decision-provider.js";
import { loadLocalEnv } from "../src/env.js";
import { saveOnboarding } from "../src/onboard.js";
import { probeSocai } from "../src/socai.js";
import { startServer } from "../src/server.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeProfile, classifyReports, rebuildIndexes } from "../src/profile/analyze.js";
import { createFsRepository, reportsRoot } from "../src/profile/adapters/fs-repository.js";
import { renderNicheIndex, renderReport, renderRootIndex } from "../src/profile/adapters/html-renderer.js";
import { createJevClassifier, loadDeck } from "../src/profile/adapters/jev-classifier.js";
import { createOpenRouterInsights } from "../src/profile/adapters/openrouter-insights.js";
import { createSocaiCollector, createSocaiRunJson } from "../src/profile/adapters/socai-collector.js";

const HELP = `jev-social — Jev-directed social research through socai CLI

Usage:
  jev-social                                      Start local preview
  jev-social onboard [options]                    Optional manual configuration
  jev-social status                               Show local readiness
  jev-social search <query> [options]             Run one search
  jev-social serve [--port 8766] [--no-open]      Start local preview
  jev-social profile <url> --niche <slug>         Analyse a TikTok/Instagram profile; <url> may be a bare @handle
  jev-social reports rebuild                      Regenerate report index pages
  jev-social reports import [dir...]              Load saved data.json reports into the local database
  jev-social reports classify [--niche <slug>]    Jev-classify saved videos (theme, format, news hook)

Search options:
  --platform <auto|instagram|tiktok|linkedin>  Platform hint (default: auto)
  --limit <1-100>                      Result limit (default: 10)
  --max-steps <1-30>                   Decision budget (default: 12)

Profile options:
  --niche <slug>                       Niche folder, e.g. football-anime (required)
  --videos <1-50>                      Items to collect (default: 12)
  --deep <0-10>                        Top items read with comments (default: 3)
  Reports go to $JEV_SOCIAL_REPORTS_DIR or ~/.jev-social/reports

Configuration (normally auto-loaded from .env):
  --api-key <key>                      OpenRouter API key (prompt is safer)
  --socai-bin <path>                   socai executable override
  --install                            Install/reinstall official socai CLI
  --skip-install                       Do not offer CLI installation
  --no-verify                          Save API key without a network check

Local decision provider (environment only):
  JEV_SOCIAL_SYSTEM_ONE_URL            Loopback /v1/systemone endpoint
  JEV_SOCIAL_SYSTEM_ONE_MODEL          Model name (default: kev-latest)
  JEV_SOCIAL_SYSTEM_ONE_TIMEOUT_MS     Timeout in ms (default/max: 120000)
`;

try {
  await loadLocalEnv();
  const [command = "serve", ...rest] = process.argv.slice(2);
  if (["help", "--help", "-h"].includes(command)) {
    console.log(HELP);
  } else if (command === "serve") {
    const flags = parseArgs(rest);
    await startServer({ port: flags.port || 8766, open: !flags.noOpen });
  } else if (command === "status") {
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
    await onboard(parseArgs(rest));
  } else if (command === "search") {
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
    const flags = parseArgs(rest);
    const deps = await profileDeps();
    const result = await analyzeProfile(deps, {
      url: flags._[0],
      niche: flags.niche,
      videos: Number(flags.videos ?? 12),
      deep: Number(flags.deep ?? 3),
    });
    if (result.snapshot.fallbackFrom) console.error(`Not found, fell back: ${result.snapshot.fallbackFrom}`);
    if (result.snapshot.partial) console.error(`Partial capture: ${result.snapshot.partialReason}`);
    if (result.classification.skipped) console.error(result.classification.skipped);
    console.log(path.join(result.dir, "report.html"));
  } else if (command === "reports") {
    if (!["rebuild", "import", "classify"].includes(rest[0])) throw new Error("Usage: jev-social reports rebuild|import|classify");
    const deps = await profileDeps();
    if (rest[0] === "import") {
      // ponytail: imports the latest report per account only; history stays in the folders.
      let count = 0;
      for (const root of rest.length > 1 ? rest.slice(1) : [reportsRoot()]) {
        for (const entry of await createFsRepository({ root }).listLatest()) {
          deps.repository.importReport(entry.data);
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
    collector: createSocaiCollector({ runJson: createSocaiRunJson({ config }) }),
    insights: createOpenRouterInsights({
      apiKey,
      model: String(process.env.OPENROUTER_REPORT_MODEL || "openai/gpt-4o-mini").trim(),
    }),
    dbPath: databasePath(),
    repository: createSqliteRepository({ db: openDatabase(databasePath()), files: createFsRepository({ root: reportsRoot() }) }),
    classifier: provider.kind === "local" || apiKey ? createJevClassifier({ apiKey, provider }) : null,
    loadDeck,
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
  let installCli = Boolean(flags.install);
  if (!before.installed && !flags.skipInstall && !flags.install) {
    installCli = await promptYesNo("socai CLI was not found. Install the official release now?", true);
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
    ["--no-verify", "noVerify"],
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
  if (!stdin.isTTY) return defaultYes;
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
