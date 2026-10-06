import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// One socai Chrome for every session (GUIDE-LOCAL §2): refuse to collect while another collection runs or just ran.
// `shop` is left out on purpose: the launchd wrapper of this very run would match itself.
const PATTERN = String.raw`/socai(\.[^ ]+)? (tiktok|instagram|linkedin|x|xhs|dy) |jev-social\.js (discover|profile|media|search)`;

async function defaultPgrep() {
  try {
    const { stdout } = await promisify(execFile)("pgrep", ["-fl", PATTERN]);
    return stdout.split("\n").filter((line) => line && !line.startsWith(`${process.pid} `)).join("\n");
  } catch {
    return ""; // ponytail: pgrep exit 1 = no match; any other failure also means "cannot prove busy"
  }
}

export async function socaiBusy({ runsDir, now = () => new Date(), pgrep = defaultPgrep, maxAgeMin = 10 }) {
  const procs = await pgrep();
  if (procs.trim()) return `socai busy: collection process running (${procs.trim().split("\n")[0]})`;
  let names;
  try { names = await readdir(runsDir); } catch { return null; }
  const limit = now().getTime() - maxAgeMin * 60_000;
  for (const name of names) {
    const info = await stat(path.join(runsDir, name)).catch(() => null);
    if (info && info.mtimeMs > limit) return `socai busy: run ${name} is younger than ${maxAgeMin} min`;
  }
  return null;
}
