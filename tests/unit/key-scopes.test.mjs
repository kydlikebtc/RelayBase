import assert from "node:assert/strict";
import test from "node:test";
import {
  FULL_ACCESS_SCOPE,
  MAX_KEY_SCOPES,
  normalizeKeyScopes,
  parseKeyScopes,
  scopeAllows,
} from "../../worker/lib/key-scopes.ts";

const endpoint = "/v1/tiktok/web/fetch_user_profile";

test("a key created before scopes existed still reaches everything", () => {
  assert.equal(
    scopeAllows(parseKeyScopes('["*"]'), { endpointPath: endpoint }),
    true,
  );
});

test("unreadable scope configuration denies every call", () => {
  for (const raw of ["not json", "{}", '"*"', "[", null, undefined, 7]) {
    assert.deepEqual(parseKeyScopes(raw), [], String(raw));
    assert.equal(
      scopeAllows(parseKeyScopes(raw), { endpointPath: endpoint }),
      false,
      "an operator mistake must not read as unlimited access",
    );
  }
});

test("an exact endpoint path grants only that endpoint", () => {
  const scopes = parseKeyScopes(JSON.stringify([endpoint]));
  assert.equal(scopeAllows(scopes, { endpointPath: endpoint }), true);
  assert.equal(
    scopeAllows(scopes, { endpointPath: "/v1/tiktok/web/fetch_user_posts" }),
    false,
  );
});

test("a path wildcard only matches whole segments", () => {
  const scopes = parseKeyScopes('["/v1/tiktok/*"]');
  assert.equal(scopeAllows(scopes, { endpointPath: endpoint }), true);
  assert.equal(
    scopeAllows(scopes, { endpointPath: "/v1/tiktokclone/web/x" }),
    false,
    "/v1/tiktok/* must not match a different platform that shares a prefix",
  );
});

test("a capability scope does not grant raw endpoint access", () => {
  const scopes = parseKeyScopes('["tiktok.user.profile"]');
  assert.equal(
    scopeAllows(scopes, {
      endpointPath: endpoint,
      capabilityId: "tiktok.user.profile",
    }),
    true,
  );
  assert.equal(
    scopeAllows(scopes, { endpointPath: endpoint }),
    false,
    "narrowing a key to one capability must keep it narrow",
  );
});

test("an endpoint scope is reachable through any capability on it", () => {
  const scopes = parseKeyScopes(JSON.stringify([endpoint]));
  assert.equal(
    scopeAllows(scopes, {
      endpointPath: endpoint,
      capabilityId: "tiktok.user.profile",
    }),
    true,
    "the scope is about the data, not the name it was reached by",
  );
});

test("a capability wildcard matches on the dot boundary", () => {
  const scopes = parseKeyScopes('["tiktok.*"]');
  assert.equal(
    scopeAllows(scopes, { endpointPath: endpoint, capabilityId: "tiktok.user.profile" }),
    true,
  );
  assert.equal(
    scopeAllows(scopes, { endpointPath: endpoint, capabilityId: "tiktokclone.user.profile" }),
    false,
  );
  assert.equal(
    scopeAllows(scopes, { endpointPath: endpoint, capabilityId: "tiktok.user" }),
    true,
    "a shorter id under the same prefix is still inside the subtree",
  );
});

test("a trailing star without a separator still respects the boundary", () => {
  const scopes = parseKeyScopes('["tiktok*"]');
  assert.equal(
    scopeAllows(scopes, { endpointPath: endpoint, capabilityId: "tiktok.user.profile" }),
    true,
  );
  assert.equal(
    scopeAllows(scopes, { endpointPath: endpoint, capabilityId: "tiktokclone.user.profile" }),
    false,
    "a bare prefix star must not leak into a neighbouring platform",
  );
});

test("scope entries beyond the cap are dropped rather than trusted", () => {
  const many = Array.from({ length: MAX_KEY_SCOPES + 10 }, (_, i) => `p.${i}`);
  const parsed = parseKeyScopes(JSON.stringify([...many, FULL_ACCESS_SCOPE]));
  assert.equal(parsed.length, MAX_KEY_SCOPES);
  assert.equal(
    scopeAllows(parsed, { endpointPath: endpoint }),
    false,
    "a star pushed past the cap must not smuggle in full access",
  );
});

test("normalizing rejects lists that would deny everything or lie", () => {
  assert.deepEqual(normalizeKeyScopes(undefined), [FULL_ACCESS_SCOPE]);
  assert.deepEqual(normalizeKeyScopes(["tiktok.*"]), ["tiktok.*"]);
  assert.deepEqual(normalizeKeyScopes(["a.b", "a.b"]), ["a.b"]);
  assert.equal(normalizeKeyScopes([]), null);
  assert.equal(normalizeKeyScopes("tiktok.*"), null);
  assert.equal(normalizeKeyScopes([""]), null);
  assert.equal(normalizeKeyScopes(["a b"]), null);
  assert.equal(normalizeKeyScopes(["a*b"]), null, "a star may only end an entry");
  assert.equal(normalizeKeyScopes(["a**"]), null);
  assert.equal(normalizeKeyScopes([1]), null);
});
