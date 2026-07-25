export const X402_VERSION = 2;
export const X402_SCHEME = "exact";
export const X402_NETWORK = "eip155:8453";
export const X402_ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const X402_BATCH_PATH = "/v1/x402/batch";
export const X402_PAYMENT_REQUIRED_HEADER = "payment-required";
export const X402_PAYMENT_SIGNATURE_HEADER = "payment-signature";
export const X402_PAYMENT_RESPONSE_HEADER = "payment-response";
export const X402_BATCH_ID_HEADER = "x-relaybase-x402-batch-id";

const CDP_FACILITATOR_HOST = "api.cdp.coinbase.com";
const DEFAULT_CDP_FACILITATOR =
  "https://api.cdp.coinbase.com/platform/v2/x402";
const MAX_FACILITATOR_RESPONSE_BYTES = 64 * 1024;

export type X402Env = {
  X402_ENABLED?: string;
  X402_PAY_TO_ADDRESS?: string;
  X402_FACILITATOR_URL?: string;
  X402_FACILITATOR_BEARER_TOKEN?: string;
  X402_FACILITATOR_ALLOW_UNAUTHENTICATED?: string;
  X402_FACILITATOR_TIMEOUT_MS?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
};

export type X402PaymentRequirements = {
  scheme: typeof X402_SCHEME;
  network: typeof X402_NETWORK;
  amount: string;
  asset: typeof X402_ASSET;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    name: "USD Coin";
    version: "2";
  };
};

export type X402BatchBinding = {
  batchId: string;
  requestHash: string;
  endpoint: string;
  verifiedQuantity: number;
  unitPriceUsdMicros: number;
  amountUsdcAtomic: number;
};

export type X402PaymentRequired = {
  x402Version: typeof X402_VERSION;
  error: string;
  resource: {
    url: string;
    description: string;
    mimeType: "application/json";
  };
  accepts: [X402PaymentRequirements];
  extensions: {
    relaybaseBatch: {
      info: X402BatchBinding;
      schema: {
        type: "object";
        required: string[];
        additionalProperties: false;
      };
    };
  };
};

export type X402PaymentPayload = {
  x402Version: number;
  resource?: Record<string, unknown>;
  accepted: Record<string, unknown>;
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
};

export type X402VerificationResponse = {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
};

export type X402SettlementResponse = {
  success: boolean;
  errorReason?: string;
  payer?: string;
  transaction?: string;
  network?: string;
};

export type X402Runtime = {
  configured: boolean;
  enabled: boolean;
  mode: "live" | "disabled" | "unconfigured";
  missing: string[];
  facilitatorUrl: string;
  facilitatorProvider: "cdp" | "custom";
  payTo: string | null;
};

export class X402ProtocolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function x402Runtime(env: X402Env): X402Runtime {
  const enabled = env.X402_ENABLED === "true";
  const missing: string[] = [];
  const payTo = normalizeEvmAddress(env.X402_PAY_TO_ADDRESS);
  if (!payTo) missing.push("pay_to_address");

  let facilitatorUrl = DEFAULT_CDP_FACILITATOR;
  try {
    facilitatorUrl = normalizeFacilitatorUrl(env.X402_FACILITATOR_URL);
  } catch {
    missing.push("facilitator_url");
  }
  const facilitator = new URL(facilitatorUrl);
  const facilitatorProvider =
    facilitator.hostname === CDP_FACILITATOR_HOST ? "cdp" : "custom";
  if (facilitatorProvider === "cdp") {
    if (!cleanSecret(env.CDP_API_KEY_ID)) missing.push("cdp_api_key_id");
    if (!cleanSecret(env.CDP_API_KEY_SECRET)) {
      missing.push("cdp_api_key_secret");
    }
  } else if (
    !cleanSecret(env.X402_FACILITATOR_BEARER_TOKEN) &&
    env.X402_FACILITATOR_ALLOW_UNAUTHENTICATED !== "true"
  ) {
    missing.push("facilitator_authentication");
  }

  return {
    configured: missing.length === 0,
    enabled,
    mode: !enabled
      ? "disabled"
      : missing.length === 0
        ? "live"
        : "unconfigured",
    missing,
    facilitatorUrl,
    facilitatorProvider,
    payTo,
  };
}

export function buildX402PaymentRequired(input: {
  origin: string;
  requirements: X402PaymentRequirements;
  binding: X402BatchBinding;
  error?: string;
}): X402PaymentRequired {
  return {
    x402Version: X402_VERSION,
    error: input.error ?? "PAYMENT-SIGNATURE header is required",
    resource: {
      url: `${input.origin}${X402_BATCH_PATH}`,
      description: `RelayBase synchronous batch for ${input.binding.endpoint}`,
      mimeType: "application/json",
    },
    accepts: [input.requirements],
    extensions: {
      relaybaseBatch: {
        info: input.binding,
        schema: {
          type: "object",
          required: [
            "batchId",
            "requestHash",
            "endpoint",
            "verifiedQuantity",
            "unitPriceUsdMicros",
            "amountUsdcAtomic",
          ],
          additionalProperties: false,
        },
      },
    },
  };
}

export function buildX402Requirements(input: {
  amountUsdcAtomic: number;
  payTo: string;
  maxTimeoutSeconds?: number;
}): X402PaymentRequirements {
  if (
    !Number.isSafeInteger(input.amountUsdcAtomic) ||
    input.amountUsdcAtomic < 1 ||
    input.amountUsdcAtomic > 100_000_000_000
  ) {
    throw new X402ProtocolError(
      "invalid_amount",
      "The x402 amount is outside the supported range.",
    );
  }
  const payTo = normalizeEvmAddress(input.payTo);
  if (!payTo) {
    throw new X402ProtocolError(
      "invalid_pay_to",
      "The x402 receiving address is invalid.",
    );
  }
  return {
    scheme: X402_SCHEME,
    network: X402_NETWORK,
    amount: String(input.amountUsdcAtomic),
    asset: X402_ASSET,
    payTo,
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? 300,
    extra: {
      name: "USD Coin",
      version: "2",
    },
  };
}

export function encodeX402Header(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeX402PaymentSignature(
  encoded: string,
): X402PaymentPayload {
  if (
    encoded.length < 16 ||
    encoded.length > 32 * 1024 ||
    !/^[A-Za-z0-9+/_=-]+$/.test(encoded)
  ) {
    throw new X402ProtocolError(
      "invalid_payment_signature",
      "PAYMENT-SIGNATURE is not valid Base64-encoded x402 JSON.",
    );
  }
  try {
    const normalized = encoded
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
    if (!isRecord(value)) throw new Error("payload must be an object");
    if (
      value.x402Version !== X402_VERSION ||
      !isRecord(value.accepted) ||
      !isRecord(value.payload)
    ) {
      throw new Error("payload has the wrong x402 v2 shape");
    }
    return value as X402PaymentPayload;
  } catch {
    throw new X402ProtocolError(
      "invalid_payment_signature",
      "PAYMENT-SIGNATURE is not valid x402 v2 JSON.",
    );
  }
}

export function assertX402PaymentBinding(input: {
  paymentPayload: X402PaymentPayload;
  paymentRequired: X402PaymentRequired;
}): void {
  const expectedRequirements = input.paymentRequired.accepts[0];
  if (
    stableJson(input.paymentPayload.accepted) !==
    stableJson(expectedRequirements)
  ) {
    throw new X402ProtocolError(
      "payment_requirement_mismatch",
      "The signed payment does not match this batch quote.",
    );
  }
  const extensions = input.paymentPayload.extensions;
  const relaybaseBatch =
    isRecord(extensions) && isRecord(extensions.relaybaseBatch)
      ? extensions.relaybaseBatch
      : null;
  const relaybaseBatchInfo =
    relaybaseBatch && isRecord(relaybaseBatch.info)
      ? relaybaseBatch.info
      : null;
  const expectedInfo =
    input.paymentRequired.extensions.relaybaseBatch.info;
  if (
    !relaybaseBatchInfo ||
    stableJson(relaybaseBatchInfo) !== stableJson(expectedInfo)
  ) {
    throw new X402ProtocolError(
      "batch_binding_mismatch",
      "The signed payment is not bound to this RelayBase batch.",
    );
  }
}

export async function verifyX402Payment(input: {
  env: X402Env;
  paymentPayload: X402PaymentPayload;
  paymentRequirements: X402PaymentRequirements;
}): Promise<X402VerificationResponse> {
  const value = await facilitatorRequest(
    input.env,
    "verify",
    input.paymentPayload,
    input.paymentRequirements,
  );
  if (
    typeof value.isValid !== "boolean" ||
    (value.payer != null && typeof value.payer !== "string") ||
    (value.invalidReason != null &&
      typeof value.invalidReason !== "string")
  ) {
    throw new X402ProtocolError(
      "facilitator_invalid_response",
      "The facilitator returned an invalid verification response.",
    );
  }
  return value as X402VerificationResponse;
}

export async function settleX402Payment(input: {
  env: X402Env;
  paymentPayload: X402PaymentPayload;
  paymentRequirements: X402PaymentRequirements;
}): Promise<X402SettlementResponse> {
  const value = await facilitatorRequest(
    input.env,
    "settle",
    input.paymentPayload,
    input.paymentRequirements,
  );
  if (
    typeof value.success !== "boolean" ||
    (value.payer != null && typeof value.payer !== "string") ||
    (value.transaction != null && typeof value.transaction !== "string") ||
    (value.network != null && typeof value.network !== "string") ||
    (value.errorReason != null && typeof value.errorReason !== "string")
  ) {
    throw new X402ProtocolError(
      "facilitator_invalid_response",
      "The facilitator returned an invalid settlement response.",
    );
  }
  return value as X402SettlementResponse;
}

export function isX402TransactionHash(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function normalizeEvmAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(normalized) ? normalized : null;
}

async function facilitatorRequest(
  env: X402Env,
  action: "verify" | "settle",
  paymentPayload: X402PaymentPayload,
  paymentRequirements: X402PaymentRequirements,
): Promise<Record<string, unknown>> {
  const runtime = x402Runtime(env);
  if (!runtime.enabled || !runtime.configured) {
    throw new X402ProtocolError(
      "x402_unavailable",
      "x402 settlement is not fully configured.",
    );
  }
  const endpoint = new URL(
    `${runtime.facilitatorUrl.replace(/\/+$/, "")}/${action}`,
  );
  const headers = new Headers({
    accept: "application/json",
    "content-type": "application/json",
  });
  if (runtime.facilitatorProvider === "cdp") {
    headers.set(
      "authorization",
      `Bearer ${await createCdpJwt(env, endpoint)}`,
    );
  } else {
    const token = cleanSecret(env.X402_FACILITATOR_BEARER_TOKEN);
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(
      boundedInteger(env.X402_FACILITATOR_TIMEOUT_MS, 30_000, 5_000, 60_000),
    ),
  });
  const body = await readBoundedResponse(response);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new X402ProtocolError(
      "facilitator_invalid_response",
      `The facilitator returned HTTP ${response.status} with a non-JSON body.`,
    );
  }
  if (!isRecord(value)) {
    throw new X402ProtocolError(
      "facilitator_invalid_response",
      "The facilitator response must be a JSON object.",
    );
  }
  if (!response.ok) {
    const reason =
      typeof value.errorReason === "string"
        ? value.errorReason
        : typeof value.invalidReason === "string"
          ? value.invalidReason
          : `http_${response.status}`;
    throw new X402ProtocolError(
      `facilitator_${action}_failed`,
      `The facilitator rejected ${action}: ${reason}.`,
    );
  }
  return value;
}

async function createCdpJwt(env: X402Env, endpoint: URL): Promise<string> {
  const keyId = cleanSecret(env.CDP_API_KEY_ID);
  const keySecret = cleanSecret(env.CDP_API_KEY_SECRET);
  if (!keyId || !keySecret) {
    throw new X402ProtocolError(
      "cdp_auth_unavailable",
      "CDP facilitator credentials are not configured.",
    );
  }
  let decoded: Uint8Array;
  try {
    const binary = atob(keySecret.replace(/\s+/g, ""));
    decoded = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
  } catch {
    throw new X402ProtocolError(
      "cdp_auth_invalid",
      "CDP_API_KEY_SECRET is not valid Base64.",
    );
  }
  if (decoded.byteLength !== 64) {
    throw new X402ProtocolError(
      "cdp_auth_invalid",
      "CDP_API_KEY_SECRET must be a 64-byte Ed25519 key.",
    );
  }
  const pkcs8Prefix = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
    0x04, 0x22, 0x04, 0x20,
  ]);
  const pkcs8 = new Uint8Array(pkcs8Prefix.length + 32);
  pkcs8.set(pkcs8Prefix);
  pkcs8.set(decoded.slice(0, 32), pkcs8Prefix.length);
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "Ed25519" },
      false,
      ["sign"],
    );
  } catch {
    throw new X402ProtocolError(
      "cdp_auth_invalid",
      "CDP Ed25519 credentials could not be imported.",
    );
  }
  const now = Math.floor(Date.now() / 1_000);
  const header = base64UrlJson({
    alg: "EdDSA",
    typ: "JWT",
    kid: keyId,
    nonce: randomHex(16),
  });
  const payload = base64UrlJson({
    iss: "cdp",
    sub: keyId,
    nbf: now,
    exp: now + 120,
    uri: `POST ${endpoint.host}${endpoint.pathname}`,
  });
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlBytes(new Uint8Array(signature))}`;
}

function normalizeFacilitatorUrl(value: unknown): string {
  const compact =
    typeof value === "string" && value.trim()
      ? value.trim()
      : DEFAULT_CDP_FACILITATOR;
  const url = new URL(compact);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname.endsWith("/"))
  ) {
    throw new Error("invalid facilitator URL");
  }
  return url.toString().replace(/\/$/, "");
}

function cleanSecret(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim().length > 0 &&
    value === value.trim()
    ? value
    : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}

async function readBoundedResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_FACILITATOR_RESPONSE_BYTES) {
      await reader.cancel("response too large");
      throw new X402ProtocolError(
        "facilitator_response_too_large",
        "The facilitator response exceeded the safety limit.",
      );
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(merged);
}

function base64UrlJson(value: unknown): string {
  return base64UrlBytes(
    new TextEncoder().encode(JSON.stringify(value)),
  );
}

function base64UrlBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
