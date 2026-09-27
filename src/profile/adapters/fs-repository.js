import { chmod, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getHomeDir } from "../../config.js";
import { AppError } from "../../errors.js";

export function reportsRoot(env = process.env) {
  return path.resolve(env.JEV_SOCIAL_REPORTS_DIR || path.join(getHomeDir(env), "reports"));
}

async function atomicWrite(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, content, { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, filePath);
  return filePath;
}

async function listDirs(dir) {
  try {
    return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function createFsRepository({ root }) {
  const inside = (...parts) => {
    const target = path.resolve(root, ...parts);
    if (target !== root && !target.startsWith(`${path.resolve(root)}${path.sep}`)) {
      throw new AppError("Report path escapes the reports directory.", { code: "INVALID_PROFILE_INPUT" });
    }
    return target;
  };
  return {
    async save({ snapshot, metrics, insights, insightNotice = null, html }) {
      const dir = inside(snapshot.niche, `${snapshot.platform}@${snapshot.handle}`, snapshot.capturedAt.slice(0, 10));
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await atomicWrite(path.join(dir, "data.json"), `${JSON.stringify({ snapshot, metrics, insights, insightNotice }, null, 2)}\n`);
      await atomicWrite(path.join(dir, "report.html"), html);
      return { dir };
    },
    async listLatest() {
      const results = [];
      for (const niche of await listDirs(root)) {
        for (const account of await listDirs(inside(niche))) {
          const date = (await listDirs(inside(niche, account))).at(-1);
          if (!date) continue;
          try {
            const data = JSON.parse(await readFile(inside(niche, account, date, "data.json"), "utf8"));
            results.push({ niche, account, date, href: `${account}/${date}/report.html`, data });
          } catch (error) {
            if (error?.code !== "ENOENT") throw error;
          }
        }
      }
      return results;
    },
    async writeIndex(relativePath, html) {
      return atomicWrite(inside(relativePath), html);
    },
  };
}
