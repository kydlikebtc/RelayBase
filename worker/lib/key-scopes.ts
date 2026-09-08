/**
 * API key scopes.
 *
 * A scope list is a JSON array of strings stored on the key. The forms are:
 *
 * - `*`                                  every endpoint and every capability
 * - `/v1/tiktok/web/fetch_user_profile`  one endpoint path
 * - `/v1/tiktok/*`                       every endpoint under a path prefix
 * - `tiktok.user.profile`                one capability id
 * - `tiktok.*`                           every capability under a dot prefix
 *
 * Entries starting with a slash are endpoint paths; everything else is a
 * capability id. The two never collide, because a capability id cannot contain
 * a slash and a path always starts with one.
 *
 * A capability call carries both a capability id and the endpoint path it
 * resolves to, and either may grant it: a key scoped to an endpoint may reach
 * it through any capability, because the scope is about the data being read.
 * The reverse does not hold, so narrowing a key to one capability keeps it
 * narrow rather than quietly granting the whole endpoint.
 *
 * Everything here is a pure function over already-parsed values, so it can be
 * unit tested without a database and evaluated before any money moves.
 */

/** Bounded so one key cannot carry a scope list that is expensive to evaluate. */
export const MAX_KEY_SCOPES = 64;
const MAX_SCOPE_LENGTH = 200;

export type KeyScopes = readonly string[];

/** Grants everything. Stored on keys created before scopes existed. */
export const FULL_ACCESS_SCOPE = "*";

function isUsableScope(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_SCOPE_LENGTH &&
    !/\s/.test(value)
  );
}

/**
 * Read stored `scopes_json`.
 *
 * Anything unreadable yields an empty list, which denies every call. A
 * malformed scope list is an operator mistake, and the safe reading of "I
 * cannot tell what this key may do" is "nothing"; defaulting to full access
 * would turn one bad write into an unbounded key.
 */
export function parseKeyScopes(raw: unknown): string[] {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const scopes: string[] = [];
  for (const entry of value.slice(0, MAX_KEY_SCOPES)) {
    if (isUsableScope(entry)) scopes.push(entry);
  }
  return scopes;
}

/**
 * Prefix match on a separator boundary.
 *
 * `tiktok.*` must not match `tiktokclone.user.profile`, and `/v1/tik*` is not
 * a path prefix: a wildcard only ever stands for whole segments.
 */
function matchesPrefix(
  candidate: string,
  pattern: string,
  separator: string,
): boolean {
  const prefix = pattern.slice(0, -1);
  if (prefix.length === 0) return true;
  if (prefix.endsWith(separator)) return candidate.startsWith(prefix);
  return candidate === prefix || candidate.startsWith(prefix + separator);
}

function scopeMatches(
  scope: string,
  candidate: string,
  separator: string,
): boolean {
  if (scope.endsWith("*")) return matchesPrefix(candidate, scope, separator);
  return scope === candidate;
}

export type ScopeTarget = {
  /** The catalog path the call executes against. Always present. */
  endpointPath: string;
  /** Set only when the call arrived through `/v1/c/{id}`. */
  capabilityId?: string | null;
};

/**
 * Does this scope list permit this call?
 *
 * An empty list denies everything, which is what {@link parseKeyScopes}
 * returns for unreadable configuration.
 */
export function scopeAllows(scopes: KeyScopes, target: ScopeTarget): boolean {
  const capabilityId = target.capabilityId ?? null;
  for (const scope of scopes) {
    if (scope === FULL_ACCESS_SCOPE) return true;
    if (scope.startsWith("/")) {
      if (scopeMatches(scope, target.endpointPath, "/")) return true;
      continue;
    }
    if (capabilityId !== null && scopeMatches(scope, capabilityId, ".")) {
      return true;
    }
  }
  return false;
}

/**
 * Validate a scope list supplied by a caller creating or editing a key.
 * Returns null when the list is unusable, so the caller can reject the write
 * rather than store something that would later deny every request.
 */
export function normalizeKeyScopes(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [FULL_ACCESS_SCOPE];
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_KEY_SCOPES) {
    return null;
  }
  const scopes: string[] = [];
  for (const entry of raw) {
    if (!isUsableScope(entry)) return null;
    // A star anywhere but the end would read as a wildcard it is not.
    if (entry !== FULL_ACCESS_SCOPE && entry.includes("*")) {
      if (!entry.endsWith("*") || entry.slice(0, -1).includes("*")) return null;
    }
    if (!scopes.includes(entry)) scopes.push(entry);
  }
  return scopes;
}
