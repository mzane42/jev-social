// Niche account discovery: one-hop snowball from keywords and seed profiles.
// See docs/superpowers/specs/2026-09-28-niche-discover-design.md.
import { buildActionArgs } from "./actions.js";
import { HANDLE, parseProfileUrl, validateNiche, validateRange } from "./profile/domain.js";

const PLATFORMS = ["tiktok", "instagram"];
const TIKTOK_AUTHOR = /^https:\/\/www\.tiktok\.com\/@([A-Za-z0-9._]{1,64})\/video\/\d+/;
const INSTAGRAM_PROFILE = /^https:\/\/www\.instagram\.com\/([A-Za-z0-9._]{1,64})\/?$/;
// ponytail: fixed list of reach-bait tags; move to niches/<slug>.json if niches need their own.
const GENERIC_TAGS = new Set(["fyp", "foryou", "foryoupage", "fy", "fypage", "pourtoi", "viral", "trending", "explore", "explorepage", "reels", "reel", "tiktok", "instagram", "xyzbca", "capcut"]);

function validHandle(handle) {
  return typeof handle === "string" && HANDLE.test(handle) && !/^\.+$/.test(handle) ? handle.toLowerCase() : null;
}

export function topHashtags(texts, limit) {
  const counts = new Map();
  for (const text of texts) {
    for (const [, tag] of String(text || "").matchAll(/#([\p{L}\p{N}_]{2,50})/gu)) {
      const key = tag.toLowerCase();
      if (!GENERIC_TAGS.has(key) && !/(?:fyp|foryou|viral|trending)$/.test(key)) counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([tag]) => tag);
}

export function mentions(texts) {
  const found = new Set();
  for (const text of texts) {
    for (const [, handle] of String(text || "").matchAll(/(?:^|[^\w.])@([A-Za-z0-9._]{1,64})/g)) {
      const clean = validHandle(handle.replace(/\.+$/, ""));
      if (clean) found.add(clean);
    }
  }
  return [...found];
}

export function tiktokSearchHandles(data) {
  return (data?.cards || []).map((card) => validHandle(TIKTOK_AUTHOR.exec(card?.url || "")?.[1])).filter(Boolean);
}

export function instagramPostAuthors(data) {
  return (data?.posts || []).map((post) => validHandle(post?.author)).filter(Boolean);
}

export function instagramAccountHandles(data) {
  return (data?.accounts || [])
    .map((account) => validHandle(account?.username) || validHandle(INSTAGRAM_PROFILE.exec(account?.url || "")?.[1]))
    .filter(Boolean);
}

function failure(data) {
  if (data?.ok !== false) return null;
  const state = data.state?.observed_state || data.state || {};
  if (data.login_required || state.login_required || /se connecter|log in/i.test(state.title || "")) return `${data.reason || "failed"} (log in to the platform in the socai Chrome window)`;
  return data.reason || "failed";
}

// deps: { runJson(args), collector.collect(target) } ; niche: { keywords, seeds }
export async function discover(deps, { slug, niche, perKeyword = 8, hashtags = 5, platforms = ["tiktok", "instagram"], onNote = () => {}, signal }) {
  validateNiche(slug);
  validateRange("--per-keyword", perKeyword, 1, 50);
  validateRange("--hashtags", hashtags, 0, 20);
  if (!platforms.length || platforms.some((p) => !PLATFORMS.includes(p))) throw new Error(`--platform must be ${PLATFORMS.join(" or ")}.`);
  const keywords = [...new Set((niche?.keywords || []).map((k) => String(k).trim()).filter(Boolean))];
  const seeds = (niche?.seeds || []).map(parseProfileUrl);
  if (!keywords.length && !seeds.length) throw new Error(`niches/${slug}.json needs "keywords" or "seeds".`);

  const candidates = new Map();
  const seedKeys = new Set(seeds.map((seed) => `${seed.platform}@${seed.handle.toLowerCase()}`));
  const add = (platform, handle, signal) => {
    const key = `${platform}@${handle}`;
    if (seedKeys.has(key)) return;
    if (!candidates.has(key)) candidates.set(key, { account: key, platform, handle, signals: new Set() });
    candidates.get(key).signals.add(signal);
  };

  const queries = keywords.map((keyword) => ({ query: keyword, signal: `keyword:${keyword}` }));
  for (const seed of seeds) {
    try {
      // Instagram grid cards carry no caption; open a few posts to read hashtags.
      const snapshot = await deps.collector.collect({ ...seed, videos: 12, deep: seed.platform === "instagram" ? 3 : 0, signal });
      const texts = [snapshot.profile?.bio, ...snapshot.items.map((item) => item.caption)];
      if (platforms.includes(seed.platform)) {
        for (const handle of mentions(texts)) add(seed.platform, handle, `mention:${seed.handle}`);
      }
      for (const tag of topHashtags(texts, hashtags)) {
        if (!queries.some((q) => q.query.toLowerCase() === tag)) queries.push({ query: tag, signal: `hashtag:${tag}` });
      }
    } catch (error) {
      onNote(`seed ${seed.platform}@${seed.handle}: ${error.message}`);
    }
  }

  for (const { query, signal: source } of queries) {
    // A query socai could read as an option (or an oversized one) is a failed search, not a failed run.
    if (query.length > 512 || query.startsWith("-")) {
      onNote(`"${query.slice(0, 40)}": skipped, invalid search query`);
      continue;
    }
    const searches = [
      ["tiktok", buildActionArgs({ platform: "tiktok", kind: "search", query, limit: perKeyword }), tiktokSearchHandles],
      ["instagram", ["instagram", "search_accounts", query, "--pretty"], instagramAccountHandles],
      // Opens each post (slow) but works where search_accounts breaks; --preview cards carry no author.
      ["instagram", ["instagram", "search", query, "--num", String(perKeyword), "--num-comments", "0", "--pretty"], instagramPostAuthors],
    ];
    for (const [platform, args, extract] of searches.filter(([p]) => platforms.includes(p))) {
      try {
        const data = await deps.runJson(args, { signal });
        const failed = failure(data);
        if (failed) onNote(`${platform} "${query}": ${failed}`);
        for (const handle of extract(data)) add(platform, handle, source);
      } catch (error) {
        onNote(`${platform} "${query}": ${error.message}`);
      }
    }
  }

  return {
    queries: queries.map((q) => q.query),
    candidates: [...candidates.values()]
      .map((c) => ({ ...c, signals: [...c.signals].sort(), score: c.signals.size }))
      .sort((a, b) => b.score - a.score || a.account.localeCompare(b.account)),
  };
}
