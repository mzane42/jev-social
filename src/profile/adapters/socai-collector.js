import { buildActionArgs } from "../../actions.js";
import { AppError } from "../../errors.js";
import { resolveSocaiBin, runSocaiJson } from "../../socai.js";
import { parseCount } from "../domain.js";

const TIKTOK_VIDEO_URL = /^https:\/\/www\.tiktok\.com\/@[\w.]+\/video\/\d+$/;

export function createSocaiRunJson({ config = {}, env = process.env, resolveBin = resolveSocaiBin, run = runSocaiJson } = {}) {
  const childEnv = { ...env, SOCAI_TELEMETRY: "0", SOCAI_TELEMETRY_QUERY_TEXT: "off", SOCAI_NO_UPDATE_CHECK: "1" };
  return async (args, { signal } = {}) => {
    const bin = await resolveBin(config, childEnv);
    return (await run(bin, args, { env: childEnv, signal })).data;
  };
}

function loginRequired(platform) {
  return new AppError(`No profile data captured: log in to ${platform} in the socai Chrome window, then retry.`, {
    code: "PROFILE_LOGIN_REQUIRED",
    status: 409,
  });
}

function profileNotFound(handle, reason) {
  const detail = reason ? ` (socai: ${reason})` : "";
  return new AppError(`No profile data captured for @${handle}${detail}: the account may be private or not exist.`, {
    code: "PROFILE_NOT_FOUND",
    status: 404,
  });
}

export function createSocaiCollector({ runJson }) {
  return {
    async collect({ platform, handle, url, videos, deep, signal }) {
      if (platform === "tiktok") {
        const author = await runJson(buildActionArgs({ platform, kind: "read_profile", target: url, limit: videos }), { signal });
        if (!author?.profile) {
          const observed = author?.state?.observed_state;
          if (author?.login_required || author?.challenge_required || observed?.login_required || observed?.challenge_required) throw loginRequired(platform);
          throw profileNotFound(handle, author?.reason);
        }
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
      if (raw?.login_required || raw?.challenge_required || raw?.state?.login_gate_present) throw loginRequired(platform);
      if (raw?.followers == null) throw profileNotFound(handle, raw?.reason);
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
    const detailCaptured = deep.has(String(card.video_id));
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
      detailCaptured,
    };
  });
  // ponytail: an unhydrated TikTok page reports followers/likes "0" with an empty video_count;
  // on a failed capture that "0" is a placeholder, so it becomes null (unknown), not a real zero.
  const hydrated = !(author?.ok === false && profile.video_count === "");
  const count = (value) => (hydrated ? parseCount(value) : null);
  const videoList = videos?.videos || [];
  const videosPartial = (videos?.failures ?? 0) > 0 || videoList.some((video) => video?.ok === false);
  const partial = author?.ok === false || videosPartial;
  let partialReason = null;
  if (partial) {
    if (author?.ok === false) {
      partialReason = String(author.reason || "incomplete");
    } else {
      const okCount = videoList.filter((video) => video?.ok !== false).length;
      const reasons = [...new Set(videoList.filter((video) => video?.ok === false).map((video) => video.reason || "unknown"))];
      partialReason = videoList.length
        ? `deep reads failed: ${okCount}/${videoList.length} completed (${reasons.join(", ")})`
        : `deep reads failed: ${videos?.failures} failure(s), no video returned`;
    }
  }
  return {
    profile: {
      displayName: profile.display_name ?? null,
      bio: profile.bio || null,
      followers: count(profile.followers),
      likes: count(profile.likes),
      postCount: parseCount(profile.video_count),
    },
    items,
    partial,
    partialReason,
  };
}

export function cleanInstagramComment(text) {
  // ponytail: Instagram appends "<age><likes> J'aime Répondre" and "Voir la traduction" on
  // following lines; keeping the first line drops them. Multi-line comments lose later lines.
  return String(text || "").split("\n")[0].trim();
}

function instagramPartialReason(raw) {
  if (raw?.reason) return String(raw.reason);
  if (raw?.deep_status?.ok === false) {
    const reasons = [...new Set((raw.deep_posts || []).filter((post) => post?.ok === false).map((post) => post.reason || "unknown"))];
    return `deep reads failed: ${raw.deep_status.completed}/${raw.deep_status.attempted} completed (${reasons.join(", ")})`;
  }
  return "incomplete";
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
      detailCaptured: Boolean(detail?.entity),
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
    partialReason: partial ? instagramPartialReason(raw) : null,
  };
}
