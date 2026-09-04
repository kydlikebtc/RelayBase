import assert from "node:assert/strict";
import test from "node:test";
import {
  AVAILABLE_BALANCE_SQL,
  SNAPSHOT_MARGIN_SECONDS,
  availableBalanceBindings,
} from "../../worker/lib/balance-sql.ts";

test("balance expression binds the user id exactly three times", () => {
  const placeholders = (AVAILABLE_BALANCE_SQL.match(/\?/g) ?? []).length;
  assert.equal(placeholders, 3);
  assert.deepEqual(availableBalanceBindings("usr_1"), [
    "usr_1",
    "usr_1",
    "usr_1",
  ]);
  assert.match(AVAILABLE_BALANCE_SQL, /balance_snapshots/);
  assert.match(AVAILABLE_BALANCE_SQL, /datetime\(l\.created_at\) > datetime\(/);
  assert.equal(SNAPSHOT_MARGIN_SECONDS, 5);
});
