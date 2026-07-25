import { headers } from "next/headers";

const FALLBACK_ORIGIN = "https://relaybase.invalid";

export async function getRequestOrigin(): Promise<string> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const directHost = requestHeaders.get("host")?.trim();
  const candidateHost = forwardedHost || directHost || "relaybase.invalid";
  const safeHost = /^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(candidateHost)
    ? candidateHost
    : "relaybase.invalid";
  const forwardedProto = requestHeaders
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();
  const protocol =
    forwardedProto === "http" ||
    safeHost.startsWith("localhost") ||
    safeHost === "127.0.0.1" ||
    safeHost.startsWith("127.0.0.1:")
      ? "http"
      : "https";

  try {
    return new URL(`${protocol}://${safeHost}`).origin;
  } catch {
    return FALLBACK_ORIGIN;
  }
}
