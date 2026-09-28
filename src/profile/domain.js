import { AppError } from "../errors.js";

const HANDLE = /^[A-Za-z0-9._]{1,64}$/;
const NICHE = /^[a-z0-9-]{1,48}$/;
const RESERVED_INSTAGRAM = new Set(["accounts", "about", "api", "challenge", "direct", "explore", "legal", "oauth", "p", "reel", "reels", "settings", "stories", "terms", "privacy"]);

function invalid(message) {
  return new AppError(message, { code: "INVALID_PROFILE_INPUT" });
}

export function parseProfileUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw invalid("Profile URL is invalid.");
  }
  const host = url.hostname.replace(/^www\./, "");
  const segment = url.pathname.split("/").filter(Boolean)[0] || "";
  let platform = null;
  let handle = "";
  if (url.protocol === "https:" && host === "tiktok.com" && segment.startsWith("@")) {
    platform = "tiktok";
    handle = segment.slice(1);
  } else if (url.protocol === "https:" && host === "instagram.com" && !RESERVED_INSTAGRAM.has(segment.toLowerCase())) {
    platform = "instagram";
    handle = segment;
  }
  if (!platform || !HANDLE.test(handle) || /^\.+$/.test(handle)) {
    throw invalid("Use a https://www.tiktok.com/@handle or https://www.instagram.com/handle profile URL.");
  }
  return {
    platform,
    handle,
    url: platform === "tiktok" ? `https://www.tiktok.com/@${handle}` : `https://www.instagram.com/${handle}/`,
  };
}

// A bare handle ("@name" or "name") has no platform: try TikTok first, then Instagram.
export function parseProfileTargets(raw) {
  const bare = typeof raw === "string" && /^@?([A-Za-z0-9._]{1,64})$/.exec(raw.trim());
  if (!bare || /^\.+$/.test(bare[1])) return [parseProfileUrl(raw)];
  return [`https://www.tiktok.com/@${bare[1]}`, `https://www.instagram.com/${bare[1]}/`].map(parseProfileUrl);
}

export function validateNiche(niche) {
  if (typeof niche !== "string" || !NICHE.test(niche)) {
    throw invalid("--niche must be a lowercase slug like football-anime (a-z, 0-9, -).");
  }
  return niche;
}

export function validateRange(name, value, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalid(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function parseCount(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const match = value.trim().replace(/,/g, "").match(/^(\d+(?:\.\d+)?)([KMB])?$/i);
  if (!match) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] ?? 1;
  return Math.round(Number(match[1]) * multiplier);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rate(part, views) {
  return part == null || !views ? null : part / views;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function computeMetrics(snapshot) {
  const followers = snapshot.profile?.followers;
  const viewed = snapshot.items.filter((item) => item.views != null);
  const medianViews = median(viewed.map((item) => item.views));
  const best = viewed.reduce((top, item) => (!top || item.views > top.views ? item : top), null);
  const dates = snapshot.items.map((item) => Date.parse(item.createdAt)).filter(Number.isFinite).sort((a, b) => a - b);
  const spanWeeks = dates.length >= 2 ? (dates.at(-1) - dates[0]) / WEEK_MS : 0;
  return {
    medianViews,
    viewsPerFollower: medianViews != null && followers ? medianViews / followers : null,
    bestItemUrl: best?.url ?? null,
    outliers: medianViews == null ? [] : viewed.filter((item) => item.views > 3 * medianViews).map((item) => item.url),
    postsPerWeek: spanWeeks > 0 ? (dates.length - 1) / spanWeeks : null,
    items: snapshot.items.map((item) => ({
      url: item.url,
      likeRate: rate(item.likes, item.views),
      shareRate: rate(item.shares, item.views),
      saveRate: rate(item.saves, item.views),
      commentRate: rate(item.comments, item.views),
    })),
  };
}
