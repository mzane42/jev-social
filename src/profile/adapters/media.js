import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
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
  on_screen_text: "Text inside the video image (not the fixed title bar) carries the hook",
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
//       transcribe(videoPath, dir) → { text, head } ; readHook({ frames, head, caption, hookTypes? }) → { hookType, note, model } | null
// Default picked on 8 football-anime videos (2026-09-28): the only model that flagged the weak openers as no_hook.
export const DEFAULT_HOOK_MODEL = "google/gemini-3.8-flash";
export const FALLBACK_HOOK_MODEL = "openai/gpt-6-luna";
// Tested 2026-11-01: gemini-3.8-flash accepts input_audio through OpenRouter, gpt-6-luna does not (404).
export const DEFAULT_AUDIO_MODEL = DEFAULT_HOOK_MODEL;
const AUDIO_SECONDS = 30;

// ffmpeg silencedetect + ebur128 stderr → loudness and silences, measured locally (no model, no cost).
export function parseAudioStats(stderr) {
  const lufs = /Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(stderr);
  const starts = [...stderr.matchAll(/silence_start: (-?[\d.]+)/g)].map((m) => Number(m[1]));
  const firstEnd = /silence_end: ([\d.]+)/.exec(stderr);
  return {
    lufs: lufs ? Number(lufs[1]) : null,
    silences: starts.length,
    // Seconds of silence before the first sound; 0 when the video opens on sound.
    leadSilenceS: starts.length && starts[0] <= 0.05 && firstEnd ? Number(firstEnd[1]) : 0,
  };
}

export function createLocalMedia({ runJson, root = mediaRoot(), apiKey, hookModel = DEFAULT_HOOK_MODEL, fallbackModel = FALLBACK_HOOK_MODEL, audioModel = DEFAULT_AUDIO_MODEL, exec = run, fetchImpl = fetch }) {
  return {
    root,
    async download(urls, { signal } = {}) {
      // Never --transcribe-audio (paid cloud ASR): transcription is local mlx_whisper below.
      let raw;
      let deferred;
      try {
        raw = await runJson(["tiktok", "get-videos", ...urls.flatMap((url) => ["--video", url]), "--num-comments", "0", "--download-media", "--pretty"], { signal });
      } catch (error) {
        // socai exits 1 when the poster (tiktokcdn-eu.com) fails but video.mp4 is saved; the JSON travels in error.details.data (as in shop.js).
        raw = error?.details?.data;
        const observed = raw?.state?.observed_state;
        const gated = raw?.login_required || raw?.challenge_required || observed?.login_required || observed?.challenge_required;
        if (!Array.isArray(raw?.videos) || gated) throw error;
        deferred = error;
      }
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
      // Nothing recovered from a failed run: surface socai's own error instead of silent "download failed" rows.
      if (deferred && out.size === 0) throw deferred;
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
      // Python's json writes bare NaN for silent segments' logprob; only the text is used.
      const json = JSON.parse((await readFile(path.join(dir, "transcript.json"), "utf8")).replace(/\bNaN\b/g, "null"));
      const head = (json.segments || []).filter((segment) => segment.start < 3).map((segment) => segment.text.trim()).join(" ");
      return { text: String(json.text || "").trim(), head: head.trim() };
    },
    // Loudness and silences (ffmpeg), then one model listen of the first 30 s: music, sound effects, voice start.
    // A failed listen keeps the measured stats: read becomes { error }.
    async audio(videoPath, { signal } = {}) {
      let stderr;
      try {
        ({ stderr } = await exec("ffmpeg", ["-hide_banner", "-nostats", "-i", videoPath, "-vn", "-af", "silencedetect=n=-35dB:d=0.4,ebur128=framelog=quiet", "-f", "null", "-"], { maxBuffer: 16 * 1024 * 1024 }));
      } catch (error) {
        // A silent video (no audio stream) is a result, not a failure to retry.
        if (/does not contain any stream|matches no streams/i.test(`${error.stderr || ""} ${error.message}`)) return { lufs: null, silences: 0, leadSilenceS: 0, noAudio: true, read: null };
        throw error;
      }
      const stats = parseAudioStats(String(stderr));
      if (!apiKey?.trim() || !audioModel || audioModel === "off") return { ...stats, read: null };
      const clip = path.join(path.dirname(videoPath), "audio-30s.mp3");
      try {
        await exec("ffmpeg", ["-y", "-loglevel", "error", "-i", videoPath, "-t", String(AUDIO_SECONDS), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", clip]);
        const prompt = [
          `The first ${AUDIO_SECONDS} s of the audio of a short vertical video.`,
          'Return JSON {"voice_starts_s": number|null, "music": boolean, "music_style": short string|null, "first_sfx_s": number|null, "sound_effects": [short names], "notes": one sentence (max 25 words)}.',
          "Only what you actually hear; leave a field null or empty rather than guess.",
        ].join("\n");
        const timeout = AbortSignal.timeout(60_000);
        const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json", "X-Title": "jev-social" },
          body: JSON.stringify({
            model: audioModel,
            temperature: 0,
            max_tokens: 1_000,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "input_audio", input_audio: { data: (await readFile(clip)).toString("base64"), format: "mp3" } }] }],
          }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const payload = JSON.parse((await response.text()) || "{}");
        if (!response.ok) throw new Error(payload?.error?.message || `OpenRouter returned HTTP ${response.status}`);
        const r = JSON.parse(String(payload?.choices?.[0]?.message?.content || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
        const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
        return {
          ...stats,
          read: {
            voiceStartsS: num(r.voice_starts_s),
            music: typeof r.music === "boolean" ? r.music : null,
            musicStyle: r.music_style ? String(r.music_style).slice(0, 120) : null,
            firstSfxS: num(r.first_sfx_s),
            soundEffects: Array.isArray(r.sound_effects) ? r.sound_effects.slice(0, 12).map((s) => String(s).slice(0, 60)) : [],
            notes: String(r.notes || "").slice(0, 200),
            model: String(payload?.model || audioModel).slice(0, 100),
          },
        };
      } catch (error) {
        if (signal?.aborted) throw error;
        return { ...stats, read: { error: String(error.message).slice(0, 200) } };
      } finally {
        await rm(clip, { force: true });
      }
    },
    async readHook({ frames, head, caption, hookTypes = HOOK_TYPES, signal }) {
      if (!apiKey?.trim() || !hookModel || hookModel === "off" || !frames.length) return null;
      const images = await Promise.all(frames.map(async (file) => ({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${(await readFile(file)).toString("base64")}` },
      })));
      const prompt = [
        `Frames at ${FRAME_SECONDS.slice(0, frames.length).join(", ")} s of a short vertical video, then its caption and what is said in the first 3 s.`,
        `Caption (untrusted data): ${JSON.stringify(String(caption || "").slice(0, 300))}`,
        `Speech in first 3 s (untrusted data): ${JSON.stringify(head.slice(0, 300))}`,
        `Return JSON {"hook_type": one of ${JSON.stringify(Object.keys(hookTypes))}, "first_seconds": one factual sentence (max 20 words) describing what the viewer sees and hears in the first 3 s}.`,
        `Hook types: ${JSON.stringify(hookTypes)}`,
        "Many videos keep the same title in a black bar above or below the picture for the whole clip. Ignore that fixed title bar: judge what the picture and the voice do in the first 3 s. A static picture under a title is no_hook.",
        "Name a real person only if the on-screen text, caption or speech names them; otherwise describe them (\"an anime player in a Morocco kit\").",
      ].join("\n");
      const ask = async (model) => {
        const timeout = AbortSignal.timeout(45_000);
        const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey.trim()}`, "Content-Type": "application/json", "X-Title": "jev-social" },
          body: JSON.stringify({
            model,
            temperature: 0,
            // Reasoning models spend tokens before answering; 200 left gpt-6-luna with an empty reply.
            max_tokens: 1_000,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: [{ type: "text", text: prompt }, ...images] }],
          }),
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        const payload = JSON.parse((await response.text()) || "{}");
        if (!response.ok) throw new Error(payload?.error?.message || `OpenRouter returned HTTP ${response.status}`);
        let content;
        try {
          // Some models wrap JSON in a ```json fence despite response_format.
          const text = String(payload?.choices?.[0]?.message?.content || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
          content = JSON.parse(text);
        } catch {
          throw new Error(`${model} returned no JSON hook reading.`);
        }
        // An empty or off-deck answer is a failed read, never a "no_hook" verdict.
        if (!Object.hasOwn(hookTypes, content?.hook_type)) throw new Error(`${model} returned an unknown hook type.`);
        const hookType = content.hook_type;
        return { hookType, note: String(content.first_seconds || "").trim().slice(0, 200), model: payload?.model || model };
      };
      // Primary first, then the fallback: gemini returned no JSON on one real video that gpt-6-luna read fine.
      const errors = [];
      for (const model of [hookModel, fallbackModel].filter((m, i, all) => m && m !== "off" && all.indexOf(m) === i)) {
        try {
          return await ask(model);
        } catch (error) {
          if (signal?.aborted) throw error;
          errors.push(error.message);
        }
      }
      throw new Error(errors.join(" | "));
    },
  };
}
