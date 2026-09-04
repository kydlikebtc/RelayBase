import assert from "node:assert/strict";
import test from "node:test";
import {
  IDENTITY_HEADER_NAMES,
  productionAuthenticationConfigured,
  trustedIdentityHeadersActive,
  withoutIdentityHeaders,
} from "../../worker/lib/identity-headers.ts";

test("identity headers stay active only while production login is incomplete", () => {
  assert.equal(
    trustedIdentityHeadersActive({ TRUST_SITES_IDENTITY_HEADERS: "true" }),
    true,
  );
  assert.equal(
    trustedIdentityHeadersActive({ TRUST_SITES_IDENTITY_HEADERS: "false" }),
    false,
  );
  const production = {
    TRUST_SITES_IDENTITY_HEADERS: "true",
    GOOGLE_CLIENT_ID: "id",
    GOOGLE_CLIENT_SECRET: "secret",
    WALLET_LOGIN_ENABLED: "true",
  };
  assert.equal(productionAuthenticationConfigured(production), true);
  assert.equal(trustedIdentityHeadersActive(production), false);
  assert.equal(
    trustedIdentityHeadersActive({
      ...production,
      WALLET_LOGIN_ENABLED: "false",
    }),
    true,
  );
  assert.equal(
    productionAuthenticationConfigured({
      ...production,
      GOOGLE_CLIENT_ID: " id ",
    }),
    false,
  );
});

test("withoutIdentityHeaders strips every oai identity header and keeps the rest", () => {
  const request = new Request("https://app.example/api/auth/me", {
    method: "POST",
    headers: {
      "oai-authenticated-user-email": "victim@example.com",
      "oai-authenticated-user-full-name": "Victim",
      "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
      authorization: "Bearer rb_live_x",
    },
    body: "{}",
  });
  const sanitized = withoutIdentityHeaders(request);
  for (const name of IDENTITY_HEADER_NAMES) {
    assert.equal(sanitized.headers.get(name), null);
  }
  assert.equal(sanitized.headers.get("authorization"), "Bearer rb_live_x");
  assert.equal(sanitized.method, "POST");
});
