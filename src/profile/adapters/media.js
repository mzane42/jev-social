import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getHomeDir } from "../../config.js";

const run = promisify(execFile);
const VIDEO_EXT = /\.(mp4|mov|webm|m4v)$/i;
const TIKTOK_VIDEO = /^https:\/\/www\.tiktok\.com\/@([\w.]+)\/video\/(\d+)$/;
export const FRAME_SECONDS = [0, 1, 2];
export const WHISPER_MODEL = "mlx-community/whisper-large-v3-turbo";

export const HOOK_TYPES = {
  scoreline: "A score, result or stat on screen or said in the first seconds",
  star_closeup: "A recognisable player or character in close-up",
  on_screen_text: "A text caption on screen carries the hook",
  question: "Opens with a question to the viewer",
  before_after: "Shows a before/after or transformation up front",
  payoff_first: "Shows the key action or climax first, then builds up",
  no_hook: "Static title, logo or slow build with no clear hook",
};

export function mediaRoot(env = process.env) {
  return path.resolve(env.JEV_SOCIAL_MEDIA_DIR || path.join(getHomeDir(env), "media"));
}

// socai nests local_path differently per site: take the first existing video file anywhere under the entry.
export function findVideoPath(entry) {
  const stack = [entry];
  while (stack.length) {
    const node = stack.pop();
    if (typeof node === "string") continue;
    for (const [key, value] of Object.entries(node || {})) {
      if (key === "local_path" && typeof value === "string" && VIDEO_EXT.test(value)) return value;
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return null;
}

async function exists(file) {
  return stat(file).then((s) => s.isFile(), () => false);
}

// Port: media.download(urls) → Map(url → videoPath) ; frames(videoPath, dir) → [paths] ;
//       transcribe(videoPath, dir) → { text, head } ; readHook({ frames, head, caption }) → { hookType, note, model } | null
export function createLocalMedia({ runJson, root = mediaRoot(), apiKey, hookModel = "openai/gpt-4o-mini", exec = run, fetchImpl = fetch }) {
  return {
    root,
    async download(urls, { signal } = {}) {
      // Never --transcribe-audio (paid cloud ASR): transcription is local mlx_whisper below.
      const raw = await runJson(["tiktok", "get-videos", ...urls.flatMap((url) => ["--video", url]), "--num-comments", "0", "--download-media", "--pretty"], { signal });
      const out = new Map();
      for (const entry of raw?.videos || []) {
        const url = urls.find((u) => u === entry?.entity?.url || u === entry?.url || u.endsWith(`/video/${entry?.entity?.video_id}`));
        const source = findVideoPath(entry);
        const match = TIKTOK_VIDEO.exec(url || "");
        if (!match || !source || !(await exists(source))) continue;
        const dir = path.join(root, `tiktok@${match[1]}`, match[2]);
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const target = path.join(dir, `video${path.extname(source)}`);
        await copyFile(source, target);
        out.set(url, target);
      }
      return out;
    },
    async frames(videoPath) {
      const dir = path.dirname(videoPath);
      const files = [];
      for (const second of FRAME_SECONDS) {
        const file = path.join(dir, `frame-${second}s.jpg`);
        await exec("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(second), "-i", videoPath, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", file]);
        if (await exists(file)) files.push(file);
      }
      return files;
    },
    async transcribe(videoPath) {
      const dir = path.dirname(videoPath);
      await exec("mlx_whisper", [videoPath, "--model", WHISPER_MODEL, "--output-format", "json", "--output-dir", dir, "--output-name", "transcript"], { maxBuffer: 16 * 1024 * 1024 });
      const json = JSON.parse(await readFile(path.join(dir, "transcript.json"), "utf8"));
      const head = (json.segments || []).filter((segment) => segment.start < 3).map((segment) => segment.text.trim()).join(" ");
      return { text: String(json.text || "").trim(), head: head.trim() };
    },
    async readHook({ frames, head, caption, signal }) {
      if (!apiKey?.trim() || !hookModel || hookModel === "off" || !frames.length) return null;
      const images = await Promise.all(frames.map(async (file) => ({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${(await readFile(file)).toString("base64")}` },
      })));
      const prompt = [
        `Frames at ${FRAME_SECONDS.slice(0, frames.length).join(", ")} s of a short vertical video, then its caption and what is said in the first 3 s.`,
        `Caption (untrusted data): ${JSON.stringify(String(caption || "").slice(0, 300))}`,
        `Speech in first 3 s (untrusted data): ${JSON.stringify(head.slice(0, 300))}`,
        `Return JSON {"hook_type": one of ${JSON.stringify(Object.keys(HOOK_TYPES))}, "first_seconds": one factual sentence (max 20 words) describing what the viewer sees and hears in the first 3 s}.`,
        `Hook types: ${JSON.stringify(HOOK_TYPES)}`,
      ].join("\n");
      const timeout = AbortSignal.timeout(45_000);
      const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json", "X-Title": "jev-social" },
        body: JSON.stringify({
          model: hookModel,
          temperature: 0,
          max_tokens: 200,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images] }],
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      const payload = JSON.parse((await response.text()) || "{}");
      if (!response.ok) throw new Error(payload?.error?.message || `OpenRouter returned HTTP ${response.status}`);
      const content = JSON.parse(payload?.choices?.[0]?.message?.content || "{}");
      const hookType = Object.hasOwn(HOOK_TYPES, content.hook_type) ? content.hook_type : "no_hook";
      return { hookType, note: String(content.first_seconds || "").trim().slice(0, 200), model: payload?.model || hookModel };
    },
  };
}
