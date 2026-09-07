/**
 * Capability input and output shaping.
 *
 * A capability presents stable field names to callers and maps them onto
 * whatever the upstream endpoint happens to call them, then pulls the item
 * array and the next cursor back out of the upstream response by JSON path.
 *
 * Every extraction here returns null on failure. An upstream response is
 * untrusted and frequently changes shape; guessing a cursor or synthesizing an
 * empty item list would silently corrupt a caller's pagination loop, so a
 * missing or wrongly-typed value is reported rather than papered over.
 */

export type CapabilityInputAliases = Readonly<Record<string, string>>;

export type CapabilityInputTranslation =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; conflict: string };

/**
 * Rename capability fields to upstream parameter names. Fields with no alias
 * pass through untouched, as the design requires, because the shared
 * `validateCatalogProxyInputs` allowlist still has to see them.
 *
 * Two capability fields landing on one upstream parameter — or an alias
 * landing on a parameter the caller already supplied — is reported instead of
 * resolved: silently dropping one of them would change what the caller asked
 * for.
 */
export function translateCapabilityInput(
  input: Readonly<Record<string, unknown>>,
  aliases: CapabilityInputAliases,
): CapabilityInputTranslation {
  const translated: Record<string, unknown> = Object.create(null);
  const claimedBy = new Map<string, string>();

  for (const [field, value] of Object.entries(input)) {
    const target = Object.hasOwn(aliases, field) ? aliases[field] : field;
    if (claimedBy.has(target)) return { ok: false, conflict: target };
    claimedBy.set(target, field);
    translated[target] = value;
  }

  return { ok: true, input: { ...translated } };
}

// Walking operator-authored paths across untrusted JSON must never reach the
// prototype chain, so these keys are rejected at parse time rather than
// filtered during the walk.
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const KEY_PATTERN = /^[A-Za-z_$][\w$]*$/;
const DIGITS_PATTERN = /^\d+$/;

export type JsonPathSegment = string | number;

/**
 * Parse `data.items[0].id` into `["data", "items", 0, "id"]`.
 *
 * Returns null for anything malformed. A path is operator-authored
 * configuration, so a typo should surface as "not configured" rather than as a
 * silently different path.
 */
export function parseJsonPath(path: string): JsonPathSegment[] | null {
  if (path.length === 0) return null;

  const segments: JsonPathSegment[] = [];
  for (const part of path.split(".")) {
    if (part.length === 0) return null;

    // Split "items[0][1]" into its key and any trailing indices.
    const bracket = part.indexOf("[");
    const key = bracket === -1 ? part : part.slice(0, bracket);
    if (!KEY_PATTERN.test(key)) return null;
    if (FORBIDDEN_KEYS.has(key)) return null;
    segments.push(key);
    if (bracket === -1) continue;

    let rest = part.slice(bracket);
    while (rest.length > 0) {
      if (!rest.startsWith("[")) return null;
      const close = rest.indexOf("]");
      if (close === -1) return null;
      const digits = rest.slice(1, close);
      if (!DIGITS_PATTERN.test(digits)) return null;
      segments.push(Number(digits));
      rest = rest.slice(close + 1);
    }
  }

  return segments;
}

/** Read the value at `path`, or undefined when any step is missing. */
export function readJsonPath(payload: unknown, path: string): unknown {
  const segments = parseJsonPath(path);
  if (segments === null) return undefined;

  let cursor: unknown = payload;
  for (const segment of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof segment === "number") {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[segment];
      continue;
    }
    if (typeof cursor !== "object") return undefined;
    if (!Object.hasOwn(cursor, segment)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Pull the item array out of a response. Null means "this response does not
 * carry a recognizable item list", which is different from an empty list and
 * must stay different to the caller.
 */
export function extractItems(
  payload: unknown,
  responseItemsPath: string | null,
): unknown[] | null {
  if (responseItemsPath === null) return null;
  const value = readJsonPath(payload, responseItemsPath);
  return Array.isArray(value) ? value : null;
}

export type CapabilityPagination = {
  requestField: string | null;
  responseCursorPath: string | null;
  pageSizeField: string | null;
  pageSizeMax: number | null;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Read stored pagination configuration. Returns null when nothing usable is
 * configured, or when the cursor path does not parse — an unparseable path
 * would otherwise look like a capability that paginates but never yields a
 * cursor.
 */
export function parseCapabilityPagination(
  raw: unknown,
): CapabilityPagination | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const source = raw as Record<string, unknown>;

  const responseCursorPath = optionalString(source.responseCursorPath);
  if (
    responseCursorPath !== null &&
    parseJsonPath(responseCursorPath) === null
  ) {
    return null;
  }

  const requestField = optionalString(source.requestField);
  const pageSizeField = optionalString(source.pageSizeField);
  const rawMax = source.pageSizeMax;
  const pageSizeMax =
    typeof rawMax === "number" && Number.isInteger(rawMax) && rawMax > 0
      ? rawMax
      : null;

  if (
    responseCursorPath === null &&
    requestField === null &&
    pageSizeField === null &&
    pageSizeMax === null
  ) {
    return null;
  }

  return { requestField, responseCursorPath, pageSizeField, pageSizeMax };
}

/**
 * Pull the next cursor out of a response.
 *
 * Only strings and finite numbers count. A boolean, object or empty string is
 * not a cursor the caller can send back, and returning one would produce a
 * pagination loop that never terminates or that refetches the same page.
 */
export function extractNextCursor(
  payload: unknown,
  pagination: CapabilityPagination | null,
): string | null {
  if (pagination === null || pagination.responseCursorPath === null)
    return null;
  const value = readJsonPath(payload, pagination.responseCursorPath);
  if (typeof value === "string") return value.length > 0 ? value : null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export type CapabilityQueryTranslation =
  | { ok: true; params: URLSearchParams }
  | { ok: false; conflict: string };

/**
 * The query-string sibling of {@link translateCapabilityInput}.
 *
 * A record cannot represent `?id=1&id=2`, and collapsing repeats would change
 * what the caller asked for, so query translation renames keys in place and
 * keeps order and multiplicity intact. Repeating one capability field is
 * allowed; two different fields landing on one upstream parameter is the same
 * conflict the record translator reports.
 */
export function translateCapabilityQuery(
  params: URLSearchParams,
  aliases: CapabilityInputAliases,
): CapabilityQueryTranslation {
  const translated = new URLSearchParams();
  const claimedBy = new Map<string, string>();

  for (const [field, value] of params) {
    const target = Object.hasOwn(aliases, field) ? aliases[field] : field;
    const owner = claimedBy.get(target);
    if (owner !== undefined && owner !== field) {
      return { ok: false, conflict: target };
    }
    claimedBy.set(target, field);
    translated.append(target, value);
  }

  return { ok: true, params: translated };
}

/** Read stored `input_aliases_json` into a plain alias map. */
export function parseCapabilityAliases(raw: unknown): CapabilityInputAliases {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const aliases: Record<string, string> = {};
  for (const [field, target] of Object.entries(raw)) {
    if (typeof target === "string" && target.length > 0) {
      aliases[field] = target;
    }
  }
  return aliases;
}
