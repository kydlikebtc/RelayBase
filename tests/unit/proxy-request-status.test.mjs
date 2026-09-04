import assert from "node:assert/strict";
import test from "node:test";
import {
  PROXY_REQUEST_STATUSES,
  isProxyRequestStatus,
  isTerminalProxyRequestStatus,
  terminalProxyRequestStatusSql,
} from "../../worker/lib/proxy-request-status.ts";

test("abandoned is a terminal status and processing is not", () => {
  assert.equal(isTerminalProxyRequestStatus("abandoned"), true);
  assert.equal(isTerminalProxyRequestStatus("reconciled"), true);
  assert.equal(isTerminalProxyRequestStatus("processing"), false);
  assert.equal(isTerminalProxyRequestStatus("charged"), false);
});

test("validates status strings and renders a SQL IN list", () => {
  assert.equal(isProxyRequestStatus("charged"), true);
  assert.equal(isProxyRequestStatus("insufficient_balance"), false);
  assert.equal(PROXY_REQUEST_STATUSES.length, 7);
  assert.equal(
    terminalProxyRequestStatusSql(),
    "'completed', 'refunded', 'reconciled', 'rate_limited', 'abandoned'",
  );
});
