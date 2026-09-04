export const IDENTITY_HEADER_NAMES = [
  "oai-authenticated-user-email",
  "oai-authenticated-user-full-name",
  "oai-authenticated-user-full-name-encoding",
] as const;

export type IdentityHeaderEnv = {
  TRUST_SITES_IDENTITY_HEADERS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  WALLET_LOGIN_ENABLED?: string;
};

function configured(value?: string): boolean {
  return Boolean(value && value.trim().length > 0 && value === value.trim());
}

export function productionAuthenticationConfigured(
  env: IdentityHeaderEnv,
): boolean {
  return (
    configured(env.GOOGLE_CLIENT_ID) &&
    configured(env.GOOGLE_CLIENT_SECRET) &&
    env.WALLET_LOGIN_ENABLED === "true"
  );
}

/** Sites 身份头只在显式开启且生产登录尚未配置齐全时才被信任。 */
export function trustedIdentityHeadersActive(env: IdentityHeaderEnv): boolean {
  return (
    env.TRUST_SITES_IDENTITY_HEADERS === "true" &&
    !productionAuthenticationConfigured(env)
  );
}

export function withoutIdentityHeaders(request: Request): Request {
  if (!IDENTITY_HEADER_NAMES.some((name) => request.headers.has(name))) {
    return request;
  }
  const headers = new Headers(request.headers);
  for (const name of IDENTITY_HEADER_NAMES) headers.delete(name);
  return new Request(request, { headers });
}
