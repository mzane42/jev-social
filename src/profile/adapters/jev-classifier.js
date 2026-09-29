import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { requestDecision } from "../../decision-provider.js";

// Fixed across niches: Jev cannot date a video, so "how long after the news" waits for the
// Story radar's event dates; this only says whether the video rides news at all.
export const NEWS_CRITERIA = {
  news_reaction: "Reacts to a specific recent real-world event (match, transfer, scandal, announcement)",
  trend_or_meme: "Rides a platform trend, sound or meme rather than a dated event",
  evergreen: "Not tied to any dated event, would read the same months later",
};

const QUESTIONS = ["theme", "format", "news"];

export async function loadDeck(niche, dir = new URL("../../../niches/", import.meta.url)) {
  let raw;
  try {
    raw = await readFile(new URL(`${niche}.json`, dir), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const deck = JSON.parse(raw);
  for (const key of ["themes", "formats"]) {
    if (!deck?.[key] || !Object.hasOwn(deck[key], "other")) throw new Error(`niches/${niche}.json: "${key}" must include "other".`);
  }
  // Optional per-niche hook types for `media`; the fixed HOOK_TYPES apply without them.
  if (deck.hooks && !Object.hasOwn(deck.hooks, "no_hook")) throw new Error(`niches/${niche}.json: "hooks" must include "no_hook".`);
  // Cache key: editing a deck (or the news criteria) re-classifies; nothing else does.
  const version = createHash("sha256").update(JSON.stringify([deck.themes, deck.formats, NEWS_CRITERIA])).digest("hex").slice(0, 12);
  return { niche, themes: deck.themes, formats: deck.formats, hooks: deck.hooks ?? null, version };
}

export function classificationText(item) {
  // ponytail: TikTok appends "créé par <account> avec <sound>"; dropping from there keeps hashtags.
  const caption = String(item.caption || "").replace(/\s*créé par .*$/su, "").trim();
  const comments = (item.topComments || []).slice(0, 5).map((entry) => entry.text).filter(Boolean);
  const transcript = String(item.transcript || "").trim();
  if (!caption && !comments.length && !transcript) return null;
  return {
    caption: caption.slice(0, 500),
    top_comments: comments.map((text) => text.slice(0, 200)),
    ...(transcript ? { spoken_transcript: transcript.slice(0, 800) } : {}),
  };
}

export function buildClassificationRequest(model, deck, item, text) {
  const question = (task, criteria) => ({ type: "choice", instructions: { task, rules: ["Judge only from the caption, comments and spoken transcript given.", "Pick other when unsure."] }, criteria });
  return {
    model,
    state: { niche: deck.niche, platform_item: text, duration_seconds: item.durationSeconds ?? null },
    questions: {
      theme: question("What is this short video about?", deck.themes),
      format: question("How is this short video built?", deck.formats),
      news: question("Does this video ride a dated real-world event?", NEWS_CRITERIA),
    },
  };
}

function readAnswer(response, key, criteria) {
  const answer = response?.answers?.[key];
  const ok = answer?.type === "choice" && Object.hasOwn(criteria, answer.choice) &&
    typeof answer.confidence === "number" && answer.confidence >= 0 && answer.confidence <= 1;
  if (!ok) throw new Error(`Jev returned an invalid "${key}" answer.`);
  return { value: answer.choice, confidence: answer.confidence };
}

// Port: classify({ deck, items, signal }) → Map(url → { theme, format, news, model }) ; null = disabled.
export function createJevClassifier({ apiKey, provider, fetchImpl = fetch }) {
  const model = provider?.model;
  return {
    async classify({ deck, items, signal }) {
      const out = new Map();
      try {
        for (const item of items) {
          const text = classificationText(item);
          if (!text) continue;
          const request = buildClassificationRequest(model, deck, item, text);
          const response = await requestDecision({ provider, apiKey, request, fetchImpl, signal });
          const criteria = { theme: deck.themes, format: deck.formats, news: NEWS_CRITERIA };
          const answers = Object.fromEntries(QUESTIONS.map((key) => [key, readAnswer(response, key, criteria[key])]));
          out.set(item.url, { ...answers, model: typeof response?.model === "string" ? response.model : model });
        }
      } catch (error) {
        error.partial = out;
        throw error;
      }
      return out;
    },
  };
}
