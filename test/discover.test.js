import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { discover, instagramAccountHandles, instagramPostAuthors, mentions, tiktokSearchHandles, topHashtags } from "../src/discover.js";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/discover/${name}.json`, import.meta.url), "utf8"));

// Success shapes are synthetic: live captures on 2026-09-28 only returned failures.
const tiktokCards = (...handles) => ({
  ok: true,
  cards: handles.map((handle, i) => ({ video_id: String(i), url: `https://www.tiktok.com/@${handle}/video/${i}` })),
});

test("topHashtags counts, drops generic tags, and breaks ties by name", () => {
  const tags = topHashtags(["#fyp #Anime #worldcup #animefyp #footballfyp", "#anime #haaland #FYP", "#worldcup #anime"], 5);
  assert.deepEqual(tags, ["anime", "worldcup", "haaland"]);
});

test("mentions keep valid handles only, lowercased and deduplicated", () => {
  assert.deepEqual(mentions(["collab with @Studio.X and @studio.x.", "mail me a@b.com", "@...", null]), ["studio.x"]);
});

test("search extractors read authors from allowed URLs only", () => {
  assert.deepEqual(
    tiktokSearchHandles({ cards: [{ url: "https://www.tiktok.com/@a.b/video/1" }, { url: "https://evil.test/@x/video/2" }, {}] }),
    ["a.b"],
  );
  assert.deepEqual(
    instagramAccountHandles({ accounts: [{ username: "One" }, { url: "https://www.instagram.com/two/" }, { username: "bad name" }] }),
    ["one", "two"],
  );
  assert.deepEqual(instagramPostAuthors(fixture("instagram-search")), ["leonrdewa"]);
  assert.deepEqual(tiktokSearchHandles(fixture("tiktok-search-timeout")), []);
  assert.deepEqual(instagramAccountHandles(fixture("instagram-search-accounts-failed")), []);
});

test("discover scores candidates by distinct signals and excludes seeds", async () => {
  const calls = [];
  const deps = {
    collector: {
      async collect({ platform }) {
        assert.equal(platform, "tiktok");
        return { profile: { bio: "team @partner_one" }, items: [{ caption: "#fyp #worldcupanime" }, { caption: "#worldcupanime #mbappe" }] };
      },
    },
    async runJson(args) {
      calls.push(args.slice(0, 3).join(" "));
      if (args[1] === "search_accounts") return { ok: true, accounts: [{ username: "ig_studio" }] };
      if (args[0] === "instagram") return { posts: [{ author: "ig_studio" }] };
      if (args[2] === "anime football") return tiktokCards("rival", "seedcreator", "rival");
      return tiktokCards("rival", "partner_one");
    },
  };
  const result = await discover(deps, {
    slug: "football-anime",
    niche: { keywords: ["anime football"], seeds: ["https://www.tiktok.com/@SeedCreator"] },
    hashtags: 2,
  });

  assert.deepEqual(result.queries, ["anime football", "worldcupanime", "mbappe"]);
  assert.equal(calls.length, 9);
  const byAccount = Object.fromEntries(result.candidates.map((c) => [c.account, c]));
  assert.equal(byAccount["tiktok@seedcreator"], undefined);
  assert.deepEqual(byAccount["tiktok@rival"].signals, ["hashtag:mbappe", "hashtag:worldcupanime", "keyword:anime football"]);
  assert.deepEqual(byAccount["tiktok@partner_one"].signals, ["hashtag:mbappe", "hashtag:worldcupanime", "mention:SeedCreator"]);
  assert.equal(byAccount["instagram@ig_studio"].score, 3);
  assert.equal(result.candidates[0].score, 3);
});

test("discover notes failed seeds and searches, keeps going, and never mocks results", async () => {
  const notes = [];
  const deps = {
    collector: {
      async collect() {
        throw new Error("No profile data captured: log in to instagram");
      },
    },
    async runJson(args) {
      if (args[0] === "tiktok") return fixture("tiktok-search-timeout");
      if (args[2] === "boom") throw new Error("socai exited 1");
      if (args[1] === "search") return { posts: [] };
      return fixture("instagram-search-accounts-failed");
    },
  };
  const result = await discover(deps, {
    slug: "football-anime",
    niche: { keywords: ["anime football", "boom"], seeds: ["https://www.instagram.com/someone/"] },
    onNote: (note) => notes.push(note),
  });

  assert.deepEqual(result.candidates, []);
  assert.match(notes[0], /^seed instagram@someone: No profile data captured/);
  assert.match(notes[1], /tiktok "anime football": search_navigation_timeout \(log in/);
  assert.match(notes[2], /instagram "anime football": search_control_not_found/);
  assert.ok(notes.some((note) => note === 'instagram "boom": socai exited 1'));
});

test("discover rejects empty niches, bad slugs, and bounds", async () => {
  const deps = { collector: {}, runJson: async () => ({}) };
  await assert.rejects(discover(deps, { slug: "x", niche: {} }), /needs "keywords" or "seeds"/);
  await assert.rejects(discover(deps, { slug: "../etc", niche: { keywords: ["a"] } }), /lowercase slug/);
  await assert.rejects(discover(deps, { slug: "x", niche: { keywords: ["a"] }, perKeyword: 0 }), /--per-keyword/);
  await assert.rejects(discover(deps, { slug: "x", niche: { seeds: ["https://evil.test/@x"] } }), /profile URL/);
});

test("saveCandidates upserts score and signals but keeps first_seen", async () => {
  const { createSqliteRepository, openDatabase } = await import("../src/profile/adapters/sqlite-repository.js");
  const db = openDatabase(":memory:");
  let day = 1;
  const repo = createSqliteRepository({ db, files: {}, now: () => new Date(`2026-09-0${day}T00:00:00Z`) });
  repo.saveCandidates("x", [{ account: "tiktok@a", score: 1, signals: ["keyword:k"] }]);
  day = 2;
  repo.saveCandidates("x", [{ account: "tiktok@a", score: 2, signals: ["keyword:k", "hashtag:h"] }]);
  const row = db.prepare("SELECT * FROM candidates").get();
  assert.equal(row.score, 2);
  assert.deepEqual(JSON.parse(row.signals), ["keyword:k", "hashtag:h"]);
  assert.match(row.first_seen, /^2026-09-01/);
  assert.match(row.last_seen, /^2026-09-02/);
});

test("discover searches only the requested platforms", async () => {
  const calls = [];
  await discover({ collector: {}, runJson: async (args) => (calls.push(args[0]), {}) }, { slug: "x", niche: { keywords: ["k"] }, platforms: ["instagram"] });
  assert.deepEqual(calls, ["instagram", "instagram"]);
});

test("discover rejects unknown platforms", async () => {
  const deps = { collector: {}, runJson: async () => ({}) };
  await assert.rejects(discover(deps, { slug: "x", niche: { keywords: ["a"] }, platforms: ["linkedin"] }), /--platform must be tiktok or instagram/);
  await assert.rejects(discover(deps, { slug: "x", niche: { keywords: ["a"] }, platforms: [] }), /--platform/);
});

test("discover skips invalid queries without aborting the run", async () => {
  const notes = [];
  const calls = [];
  const result = await discover(
    { collector: {}, runJson: async (args) => (calls.push(args[2]), { posts: [{ author: "ok_one" }] }) },
    { slug: "x", niche: { keywords: ["--evil", "good"] }, platforms: ["instagram"], onNote: (n) => notes.push(n) },
  );
  assert.deepEqual(calls, ["good", "good"]);
  assert.match(notes[0], /"--evil": skipped, invalid search query/);
  assert.equal(result.candidates[0].account, "instagram@ok_one");
});

test("seed mentions only count on the requested platforms; seed hashtags still search", async () => {
  const calls = [];
  const result = await discover(
    {
      collector: { collect: async () => ({ profile: { bio: "@friend" }, items: [{ caption: "#animefoot" }] }) },
      runJson: async (args) => (calls.push(args.slice(0, 3).join(" ")), {}),
    },
    { slug: "x", niche: { seeds: ["https://www.tiktok.com/@seed"] }, platforms: ["instagram"] },
  );
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(calls, ["instagram search_accounts animefoot", "instagram search animefoot"]);
});
