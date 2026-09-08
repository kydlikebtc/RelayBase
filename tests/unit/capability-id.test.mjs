import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  CAPABILITY_ID_MAX_LENGTH,
  CAPABILITY_ID_PATTERN,
  capabilityIdCheckSql,
  deriveCapabilityId,
  isCapabilityId,
  normalizeCapabilitySegment,
} from "../../worker/lib/capability-id.ts";

test("accepts two to four lowercase dot-separated segments", () => {
  assert.equal(isCapabilityId("douyin.user.profile"), true);
  assert.equal(isCapabilityId("tiktok.video"), true);
  assert.equal(isCapabilityId("tiktok.content.video.detail"), true);
  assert.equal(isCapabilityId("x.social_graph.followers"), true);
});

// The design document's regex starts the id with [a-z0-9]+, which cannot spell
// the platform slugs this catalog actually ships (wechat_mp, temp_mail,
// ios_shortcut, net_ease_cloud_music). Underscores are allowed in every
// segment instead, so those platforms can hold capabilities at all.
test("allows underscores in the platform segment so real platforms are addressable", () => {
  assert.equal(isCapabilityId("wechat_mp.content.article"), true);
  assert.equal(isCapabilityId("net_ease_cloud_music.media_download.track"), true);
  assert.equal(isCapabilityId("ios_shortcut.utility.run"), true);
});

test("rejects malformed ids", () => {
  assert.equal(isCapabilityId("douyin"), false, "a single segment is not an id");
  assert.equal(isCapabilityId("a.b.c.d.e"), false, "five segments is too many");
  assert.equal(isCapabilityId("Douyin.user.profile"), false, "uppercase");
  assert.equal(isCapabilityId("douyin..profile"), false, "empty segment");
  assert.equal(isCapabilityId(".douyin.profile"), false, "leading dot");
  assert.equal(isCapabilityId("douyin.profile."), false, "trailing dot");
  assert.equal(isCapabilityId("douyin.user profile"), false, "space");
  assert.equal(isCapabilityId("douyin.user-profile"), false, "hyphen");
  assert.equal(isCapabilityId("_douyin.user.profile"), false, "leading underscore");
  assert.equal(isCapabilityId("douyin_.user.profile"), false, "trailing underscore");
  assert.equal(isCapabilityId("douyin__mp.user.profile"), false, "double underscore");
  assert.equal(isCapabilityId(""), false);
  assert.equal(isCapabilityId(null), false);
  assert.equal(isCapabilityId(42), false);
});

test("rejects ids longer than the column budget", () => {
  const long = `${"a".repeat(CAPABILITY_ID_MAX_LENGTH)}.user.profile`;
  assert.equal(long.length > CAPABILITY_ID_MAX_LENGTH, true);
  assert.equal(isCapabilityId(long), false);
});

test("normalizes a raw segment into slug shape", () => {
  assert.equal(normalizeCapabilitySegment("Fetch Multi Video"), "fetch_multi_video");
  assert.equal(normalizeCapabilitySegment("handler-user-profile"), "handler_user_profile");
  assert.equal(normalizeCapabilitySegment("  __trim__  "), "trim");
  assert.equal(normalizeCapabilitySegment("v3"), "v3");
  assert.equal(normalizeCapabilitySegment("///"), null, "nothing usable left");
  assert.equal(normalizeCapabilitySegment(""), null);
});

test("derives a draft id from platform, data type and the last path segment", () => {
  assert.equal(
    deriveCapabilityId({
      platform: "tiktok",
      dataType: "content",
      path: "/v1/tiktok/app/v3/fetch_multi_video",
    }),
    "tiktok.content.fetch_multi_video",
  );
  assert.equal(
    deriveCapabilityId({
      platform: "wechat_mp",
      dataType: "search_discovery",
      path: "/v1/wechat_mp/search/articles",
    }),
    "wechat_mp.search_discovery.articles",
  );
});

test("derivation ignores trailing slashes and path parameters", () => {
  assert.equal(
    deriveCapabilityId({
      platform: "douyin",
      dataType: "profile_creator",
      path: "/v1/douyin/web/handler_user_profile/",
    }),
    "douyin.profile_creator.handler_user_profile",
  );
  assert.equal(
    deriveCapabilityId({
      platform: "douyin",
      dataType: "account",
      path: "/v1/douyin/user/{sec_user_id}",
    }),
    "douyin.account.sec_user_id",
  );
});

test("derivation returns null rather than an invalid id", () => {
  assert.equal(
    deriveCapabilityId({ platform: "", dataType: "content", path: "/v1/a/b" }),
    null,
  );
  assert.equal(
    deriveCapabilityId({ platform: "tiktok", dataType: "content", path: "/" }),
    null,
    "no usable last segment",
  );
  assert.equal(
    deriveCapabilityId({ platform: "tiktok", dataType: "", path: "/v1/a/b" }),
    null,
  );
});

test("the SQLite CHECK expression matches the JavaScript validator on shape", () => {
  const sql = capabilityIdCheckSql("id");
  assert.match(sql, /GLOB/, "SQLite has no REGEXP, so the guard is GLOB based");
  assert.match(sql, /length\(id\)/, "length is bounded in SQL too");
  // The SQL guard is deliberately looser than the regex; it must never be
  // stricter, or a value the application accepts would fail to insert.
  assert.doesNotMatch(sql, /\{/, "GLOB has no repetition counts");
});

test("the exported pattern is anchored", () => {
  assert.equal(CAPABILITY_ID_PATTERN.source.startsWith("^"), true);
  assert.equal(CAPABILITY_ID_PATTERN.source.endsWith("$"), true);
  assert.equal(CAPABILITY_ID_PATTERN.global, false, "a global regex carries lastIndex state");
});

// A CHECK that is stricter than the validator would reject legitimate inserts
// at runtime, which no amount of shape assertions can catch. Exercise the real
// SQLite implementation instead of trusting the GLOB list by inspection.
test("the SQLite CHECK never rejects an id the validator accepts", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(
      `CREATE TABLE capabilities (id TEXT PRIMARY KEY, CHECK (${capabilityIdCheckSql("id")}))`,
    );
    const insert = db.prepare("INSERT INTO capabilities (id) VALUES (?)");
    const samples = [
      "douyin.user.profile",
      "tiktok.video",
      "tiktok.content.video.detail",
      "x.social_graph.followers",
      "wechat_mp.content.article",
      "net_ease_cloud_music.media_download.track",
      "ios_shortcut.utility.run",
      "douyin",
      "a.b.c.d.e",
      "Douyin.user.profile",
      "douyin..profile",
      ".douyin.profile",
      "douyin.profile.",
      "douyin.user profile",
      "douyin.user-profile",
      "_douyin.user.profile",
      "douyin_.user.profile",
      "douyin__mp.user.profile",
      "",
    ];
    for (const sample of samples) {
      let accepted = true;
      try {
        insert.run(sample);
      } catch {
        accepted = false;
      }
      if (isCapabilityId(sample)) {
        assert.equal(accepted, true, `SQL rejected a valid id: ${sample}`);
      }
    }
  } finally {
    db.close();
  }
});
