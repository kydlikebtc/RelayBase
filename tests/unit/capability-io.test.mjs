import assert from "node:assert/strict";
import test from "node:test";
import {
  extractItems,
  extractNextCursor,
  parseCapabilityPagination,
  parseJsonPath,
  readJsonPath,
  translateCapabilityInput,
} from "../../worker/lib/capability-io.ts";

test("translates capability field names into upstream parameter names", () => {
  const result = translateCapabilityInput(
    { userId: "abc", count: 20 },
    { userId: "sec_user_id", count: "page_size" },
  );
  assert.deepEqual(result, {
    ok: true,
    input: { sec_user_id: "abc", page_size: 20 },
  });
});

test("passes unknown fields through untouched", () => {
  const result = translateCapabilityInput(
    { userId: "abc", cursor: "c1" },
    { userId: "sec_user_id" },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.input, { sec_user_id: "abc", cursor: "c1" });
});

test("aliases that are absent from the input do not invent keys", () => {
  const result = translateCapabilityInput({ a: 1 }, { missing: "upstream" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.input, { a: 1 });
});

test("reports two capability fields mapping onto one upstream parameter", () => {
  const result = translateCapabilityInput(
    { userId: "a", uid: "b" },
    { userId: "sec_user_id", uid: "sec_user_id" },
  );
  assert.equal(result.ok, false);
  assert.equal(result.conflict, "sec_user_id");
});

test("reports an alias colliding with a passed-through field", () => {
  const result = translateCapabilityInput(
    { userId: "a", sec_user_id: "b" },
    { userId: "sec_user_id" },
  );
  assert.equal(result.ok, false);
  assert.equal(result.conflict, "sec_user_id");
});

test("a field aliased onto its own name is not a conflict", () => {
  const result = translateCapabilityInput({ cursor: "c" }, { cursor: "cursor" });
  assert.equal(result.ok, true);
  assert.deepEqual(result.input, { cursor: "c" });
});

test("parses dot and index path syntax", () => {
  assert.deepEqual(parseJsonPath("data.aweme_list"), ["data", "aweme_list"]);
  assert.deepEqual(parseJsonPath("data.items[0].id"), ["data", "items", 0, "id"]);
  assert.deepEqual(parseJsonPath("root"), ["root"]);
});

test("rejects malformed paths instead of guessing", () => {
  assert.equal(parseJsonPath(""), null);
  assert.equal(parseJsonPath("."), null);
  assert.equal(parseJsonPath("a..b"), null);
  assert.equal(parseJsonPath("a[]"), null);
  assert.equal(parseJsonPath("a[-1]"), null);
  assert.equal(parseJsonPath("a[1.5]"), null);
  assert.equal(parseJsonPath("a."), null);
});

// An upstream response is untrusted input. A path walker that follows
// __proto__ hands a hostile upstream a route to Object.prototype.
test("refuses to traverse prototype keys", () => {
  assert.equal(parseJsonPath("__proto__"), null);
  assert.equal(parseJsonPath("data.__proto__.polluted"), null);
  assert.equal(parseJsonPath("data.constructor"), null);
  assert.equal(parseJsonPath("data.prototype"), null);
});

test("reads a value at a path and returns undefined when absent", () => {
  const payload = { data: { aweme_list: [{ id: "1" }], cursor: "next" } };
  assert.deepEqual(readJsonPath(payload, "data.aweme_list"), [{ id: "1" }]);
  assert.equal(readJsonPath(payload, "data.aweme_list[0].id"), "1");
  assert.equal(readJsonPath(payload, "data.cursor"), "next");
  assert.equal(readJsonPath(payload, "data.missing"), undefined);
  assert.equal(readJsonPath(payload, "data.aweme_list[9]"), undefined);
  assert.equal(readJsonPath(payload, "nope.nope"), undefined);
  assert.equal(readJsonPath(null, "data"), undefined);
  assert.equal(readJsonPath(payload, "bad..path"), undefined);
});

test("extracts an items array, or null when the path does not hold one", () => {
  const payload = { data: { aweme_list: [{ id: "1" }, { id: "2" }] } };
  assert.deepEqual(extractItems(payload, "data.aweme_list"), [
    { id: "1" },
    { id: "2" },
  ]);
  assert.equal(extractItems(payload, "data.missing"), null, "absent path");
  assert.equal(extractItems(payload, "data"), null, "not an array");
  assert.equal(extractItems(payload, null), null, "no configured path");
  assert.deepEqual(extractItems({ data: { list: [] } }, "data.list"), []);
});

test("extracts a next cursor only when it is a usable non-empty scalar", () => {
  const pagination = parseCapabilityPagination({
    requestField: "cursor",
    responseCursorPath: "data.next_cursor",
    pageSizeField: "count",
    pageSizeMax: 50,
  });
  assert.notEqual(pagination, null);
  assert.equal(
    extractNextCursor({ data: { next_cursor: "abc" } }, pagination),
    "abc",
  );
  assert.equal(
    extractNextCursor({ data: { next_cursor: 42 } }, pagination),
    "42",
    "numeric cursors are stringified",
  );
  assert.equal(extractNextCursor({ data: {} }, pagination), null, "absent");
  assert.equal(
    extractNextCursor({ data: { next_cursor: "" } }, pagination),
    null,
    "an empty cursor is not a cursor",
  );
  assert.equal(
    extractNextCursor({ data: { next_cursor: null } }, pagination),
    null,
  );
  assert.equal(
    extractNextCursor({ data: { next_cursor: { a: 1 } } }, pagination),
    null,
    "objects are not cursors",
  );
  assert.equal(
    extractNextCursor({ data: { next_cursor: false } }, pagination),
    null,
    "booleans are not cursors",
  );
  assert.equal(extractNextCursor({ data: { next_cursor: "x" } }, null), null);
});

test("parses pagination configuration and rejects unusable shapes", () => {
  assert.equal(parseCapabilityPagination(null), null);
  assert.equal(parseCapabilityPagination("not an object"), null);
  assert.equal(parseCapabilityPagination({}), null, "nothing usable configured");
  assert.equal(
    parseCapabilityPagination({ responseCursorPath: "a..b" }),
    null,
    "an unparseable cursor path is not accepted",
  );
  const minimal = parseCapabilityPagination({ responseCursorPath: "cursor" });
  assert.deepEqual(minimal, {
    requestField: null,
    responseCursorPath: "cursor",
    pageSizeField: null,
    pageSizeMax: null,
  });
  assert.equal(
    parseCapabilityPagination({ responseCursorPath: "cursor", pageSizeMax: 0 })
      .pageSizeMax,
    null,
    "a non-positive page size ceiling is dropped",
  );
  assert.equal(
    parseCapabilityPagination({ responseCursorPath: "cursor", pageSizeMax: 1.5 })
      .pageSizeMax,
    null,
    "a fractional page size ceiling is dropped",
  );
});

test("translation does not mutate its inputs", () => {
  const input = { userId: "a" };
  const aliases = { userId: "sec_user_id" };
  translateCapabilityInput(input, aliases);
  assert.deepEqual(input, { userId: "a" });
  assert.deepEqual(aliases, { userId: "sec_user_id" });
});
