import assert from "node:assert/strict";
import test from "node:test";
import { TtlCache, parseTtlMs } from "../../worker/lib/ttl-cache.ts";

test("remember returns the cached promise inside the ttl and recomputes after it", async () => {
  let now = 1_000;
  const cache = new TtlCache(() => now);
  const key = {};
  let computed = 0;
  const compute = async () => ++computed;

  assert.equal(await cache.remember(key, 500, compute), 1);
  assert.equal(await cache.remember(key, 500, compute), 1);
  now = 1_499;
  assert.equal(await cache.remember(key, 500, compute), 1);
  now = 1_500;
  assert.equal(await cache.remember(key, 500, compute), 2);
});

test("ttl of zero bypasses the cache and rejections are evicted", async () => {
  const cache = new TtlCache(() => 0);
  const key = {};
  let calls = 0;
  await cache.remember(key, 0, async () => ++calls);
  await cache.remember(key, 0, async () => ++calls);
  assert.equal(calls, 2);

  await assert.rejects(
    cache.remember(key, 1_000, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  assert.equal(await cache.remember(key, 1_000, async () => 42), 42);
});

test("delete forces recomputation and keys are isolated", async () => {
  const cache = new TtlCache(() => 0);
  const a = {};
  const b = {};
  assert.equal(await cache.remember(a, 1_000, async () => "a1"), "a1");
  assert.equal(await cache.remember(b, 1_000, async () => "b1"), "b1");
  cache.delete(a);
  assert.equal(await cache.remember(a, 1_000, async () => "a2"), "a2");
  assert.equal(await cache.remember(b, 1_000, async () => "b2"), "b1");
});

test("parseTtlMs clamps and falls back", () => {
  assert.equal(parseTtlMs(undefined, 10_000, 60_000), 10_000);
  assert.equal(parseTtlMs("abc", 10_000, 60_000), 10_000);
  assert.equal(parseTtlMs("-5", 10_000, 60_000), 10_000);
  assert.equal(parseTtlMs("0", 10_000, 60_000), 0);
  assert.equal(parseTtlMs("999999", 10_000, 60_000), 60_000);
  assert.equal(parseTtlMs("2500", 10_000, 60_000), 2_500);
});
