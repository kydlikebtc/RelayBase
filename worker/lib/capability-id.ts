/**
 * Capability identifiers.
 *
 * A capability id is the public name an Agent calls: `/v1/c/{capabilityId}`.
 * It is a dot-separated slug of two to four segments, conventionally
 * `platform.dataType.action`, for example `douyin.user.profile`.
 *
 * The design document spells the first segment `[a-z0-9]+`, which cannot
 * represent the platform slugs this catalog actually ships (`wechat_mp`,
 * `temp_mail`, `ios_shortcut`, `net_ease_cloud_music`). Underscores are
 * therefore allowed in every segment, while leading, trailing and doubled
 * underscores stay rejected so one platform cannot own two spellings of the
 * same name.
 */

/** Bounded so the primary key stays index-friendly and log lines stay readable. */
export const CAPABILITY_ID_MAX_LENGTH = 96;

const SEGMENT = "[a-z0-9]+(?:_[a-z0-9]+)*";

/** Two to four segments: one leading segment plus one to three more. */
export const CAPABILITY_ID_PATTERN = new RegExp(
  `^${SEGMENT}(?:\\.${SEGMENT}){1,3}$`,
);

export type CapabilityId = string & { readonly __capabilityId: unique symbol };

export function isCapabilityId(value: unknown): value is CapabilityId {
  return (
    typeof value === "string" &&
    value.length <= CAPABILITY_ID_MAX_LENGTH &&
    CAPABILITY_ID_PATTERN.test(value)
  );
}

/**
 * Fold arbitrary text into one slug segment: lowercase, non-alphanumerics
 * become underscores, runs collapse, and edges are trimmed. Returns null when
 * nothing usable survives, so callers never build an id out of punctuation.
 */
export function normalizeCapabilitySegment(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return slug.length > 0 ? slug : null;
}

/** The last meaningful path element, with any `{param}` braces folded away. */
function lastPathSegment(path: string): string | null {
  const parts = path.split("/").filter((part) => part.length > 0);
  const last = parts.at(-1);
  return last === undefined ? null : last;
}

/**
 * Derive the draft id an operator starts from when promoting a catalog
 * endpoint to a capability. Returns null instead of an invalid id so the
 * caller has to decide what to do rather than persisting something the
 * database would reject.
 */
export function deriveCapabilityId(input: {
  platform: string;
  dataType: string;
  path: string;
}): CapabilityId | null {
  const platform = normalizeCapabilitySegment(input.platform);
  const dataType = normalizeCapabilitySegment(input.dataType);
  const tail = lastPathSegment(input.path);
  const action = tail === null ? null : normalizeCapabilitySegment(tail);
  if (platform === null || dataType === null || action === null) return null;

  const candidate = `${platform}.${dataType}.${action}`;
  return isCapabilityId(candidate) ? candidate : null;
}

/**
 * A SQLite CHECK expression guarding the same shape.
 *
 * SQLite ships no REGEXP, so this is GLOB based and therefore deliberately
 * *looser* than {@link CAPABILITY_ID_PATTERN}: it must never reject a value the
 * application accepts, or a legitimate insert would fail at the database. The
 * application validator stays authoritative; this only stops obviously broken
 * rows written outside it.
 */
export function capabilityIdCheckSql(column: string): string {
  return [
    `length(${column}) BETWEEN 3 AND ${CAPABILITY_ID_MAX_LENGTH}`,
    // Character set: lowercase letters, digits, dot and underscore only.
    `${column} NOT GLOB '*[^a-z0-9._]*'`,
    // At least one dot (two segments) and at most three (four segments).
    `${column} GLOB '*.*'`,
    `${column} NOT GLOB '*.*.*.*.*'`,
    // No empty segment, and no dot or underscore on either edge.
    `${column} NOT GLOB '*..*'`,
    `${column} NOT GLOB '.*'`,
    `${column} NOT GLOB '*.'`,
    `${column} NOT GLOB '_*'`,
    `${column} NOT GLOB '*_'`,
    // No doubled underscore, and none straddling a segment boundary.
    `${column} NOT GLOB '*__*'`,
    `${column} NOT GLOB '*._*'`,
    `${column} NOT GLOB '*_.*'`,
  ].join(" AND ");
}
