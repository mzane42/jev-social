import { buildActionArgs } from "../../actions.js";
import { AppError } from "../../errors.js";
import { resolveSocaiBin, runSocaiJson } from "../../socai.js";
import { parseCount } from "../domain.js";

const TIKTOK_VIDEO_URL = /^https:\/\/www\.tiktok\.com\/@[\w.]+\/video\/\d+$/;

export function createSocaiRunJson({ config = {}, env = process.env } = {}) {
  const childEnv = { ...env, SOCAI_TELEMETRY: "0", SOCAI_TELEMETRY_QUERY_TEXT: "off", SOCAI_NO_UPDATE_CHECK: "1" };
  return async (args, { signal } = {}) => {
    const bin = await resolveSocaiBin(config, childEnv);
    return (await runSocaiJson(bin, args, { env: childEnv, signal })).data;
  };
}

function loginRequired(platform) {
  return new AppError(`No profile data captured: log in to ${platform} in the socai Chrome window, then retry.`, {
    code: "PROFILE_LOGIN_REQUIRED",
    status: 409,
  });
}

export function createSocaiCollector({ runJson }) {
  return {
    async collect({ platform, url, videos, deep, signal }) {
      if (platform === "tiktok") {
        const author = await runJson(buildActionArgs({ platform, kind: "read_profile", target: url, limit: videos }), { signal });
        if (!author?.profile) throw loginRequired(platform);
        const top = [...(author.profile.video_cards || [])]
          .filter((card) => TIKTOK_VIDEO_URL.test(card?.url || ""))
          .sort((a, b) => (parseCount(b.views) ?? -1) - (parseCount(a.views) ?? -1))
          .slice(0, deep);
        const details = top.length
          ? await runJson(["tiktok", "get-videos", ...top.flatMap((card) => ["--video", card.url]), "--num-comments", "8", "--pretty"], { signal })
          : null;
        return normalizeTikTok(author, details);
      }
      const raw = await runJson(
        ["instagram", "profile", url, "--num", String(videos), "--deep", String(deep), "--num-comments", "8", "--pretty"],
        { signal },
      );
      if (!raw || raw.followers == null) throw loginRequired(platform);
      return normalizeInstagram(raw);
    },
  };
}

function comment(text, likes) {
  return { text, likes: parseCount(likes) };
}

export function normalizeTikTok(author, videos) {
  const profile = author?.profile || {};
  const deep = new Map(
    (videos?.videos || []).filter((video) => video?.ok !== false && video?.entity).map((video) => [String(video.entity.video_id), video.entity]),
  );
  const items = (profile.video_cards || []).map((card) => {
    const detail = deep.get(String(card.video_id)) || {};
    return {
      url: card.url,
      kind: "video",
      caption: detail.description ?? card.title ?? null,
      createdAt: detail.created_at ?? null,
      durationSeconds: detail.duration_seconds || card.duration_seconds || null,
      views: parseCount(detail.views ?? card.views),
      likes: parseCount(detail.likes ?? card.likes),
      comments: parseCount(detail.comments_count ?? card.comments),
      shares: parseCount(detail.shares ?? card.shares),
      saves: parseCount(detail.favorites),
      topComments: (detail.top_comments || [])
        .map((entry) => comment(String(entry?.text || "").trim(), entry?.likes))
        .filter((entry) => entry.text),
    };
  });
  const partial = author?.ok === false;
  return {
    profile: {
      displayName: profile.display_name ?? null,
      bio: profile.bio || null,
      followers: parseCount(profile.followers),
      likes: parseCount(profile.likes),
      postCount: parseCount(profile.video_count),
    },
    items,
    partial,
    partialReason: partial ? String(author.reason || "incomplete") : null,
  };
}

export function cleanInstagramComment(text) {
  // ponytail: Instagram appends "<age><likes> J'aime Répondre" and "Voir la traduction" on
  // following lines; keeping the first line drops them. Multi-line comments lose later lines.
  return String(text || "").split("\n")[0].trim();
}

export function normalizeInstagram(raw) {
  const deep = new Map((raw?.deep_posts || []).filter((entry) => entry?.entity).map((entry) => [entry.entity.id, entry]));
  const items = (raw?.posts || []).map((post) => {
    const detail = deep.get(post.id);
    const entity = detail?.entity || {};
    return {
      url: post.url,
      kind: post.kind || "post",
      caption: entity.caption ?? null,
      createdAt: entity.published_at ?? null,
      durationSeconds: null,
      views: null,
      likes: parseCount(entity.engagement?.likes),
      comments: parseCount(entity.engagement?.comments),
      shares: null,
      saves: null,
      topComments: (detail?.comments || [])
        .map((entry) => comment(cleanInstagramComment(entry?.text), entry?.likes))
        .filter((entry) => entry.text),
    };
  });
  const partial = raw?.ok === false || raw?.deep_status?.ok === false;
  return {
    profile: {
      displayName: raw?.display_name ?? null,
      bio: raw?.bio || null,
      followers: parseCount(raw?.followers),
      likes: null,
      postCount: parseCount(raw?.post_count),
    },
    items,
    partial,
    partialReason: partial ? String(raw?.reason || "incomplete") : null,
  };
}
