export const PROVIDER_SURFACES = ["app", "web", "app_web", "other"];

export const PROVIDER_DATA_TYPES = [
  "account",
  "analytics_trends",
  "comments",
  "commerce_marketing",
  "content",
  "email",
  "live",
  "media_download",
  "profile_creator",
  "search_discovery",
  "social_graph",
  "system",
  "taxonomy",
  "utility",
  "other",
];

export function providerSurfaceForPath(sourcePath, tags) {
  const segments = sourcePath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  const versionIndex = segments.findIndex((segment) =>
    /^v\d+$/i.test(segment),
  );
  const routeSegments =
    versionIndex >= 0 ? segments.slice(versionIndex + 2, -1) : [];
  const tagText = tags.join(" ").toLowerCase();
  const hybrid =
    tagText.includes("hybrid") ||
    routeSegments.some((segment) => segment.includes("hybrid"));
  const app =
    /(?:^|[-_\s])app(?:[-_\s]|$)/.test(tagText) ||
    /(?:^|[-_\s])ios(?:[-_\s]|$)/.test(tagText) ||
    routeSegments.some(
      (segment) =>
        segment === "app" ||
        segment.startsWith("app_") ||
        segment.startsWith("ios"),
    );
  const web =
    /(?:^|[-_\s])web(?:[-_\s]|$)/.test(tagText) ||
    routeSegments.some(
      (segment) => segment === "web" || segment.startsWith("web_"),
    );

  if (hybrid || (app && web)) return "app_web";
  if (app) return "app";
  if (web) return "web";
  return "other";
}

function matchesAny(text, expressions) {
  return expressions.some((expression) => expression.test(text));
}

export function providerDataTypeFor({
  platform,
  sourcePath,
  tags,
  operationId,
}) {
  const rawText = [platform, sourcePath, operationId ?? "", ...tags]
    .join(" ")
    .toLowerCase();
  const text = rawText.replace(/[^a-z0-9]+/g, " ");

  if (["health", "demo", "ios_shortcut"].includes(platform)) return "system";
  if (
    platform === "temp_mail" ||
    matchesAny(text, [/\btemp mail\b/, /\binbox\b/, /\bemail\b/])
  ) {
    return "email";
  }
  if (
    matchesAny(text, [
      /\bshop\b/,
      /\bads\b/,
      /\bdouplus\b/,
      /\bxingtu\b/,
      /\bpgy\b/,
      /\bproduct\b/,
      /\border\b/,
      /\be commerce\b/,
      /\baffiliate\b/,
      /\bshowcase\b/,
    ])
  ) {
    return "commerce_marketing";
  }
  if (
    matchesAny(text, [
      /\bindex api\b/,
      /\banalytics api\b/,
      /\bbillboard api\b/,
      /\banalytics?\b/,
      /\banalys(?:e|is)\b/,
      /\bstats?\b/,
      /\binsights?\b/,
      /\boverview\b/,
      /\bdiagnosis\b/,
      /\baudience\b/,
      /\bperformance\b/,
      /\bmetrics?\b/,
      /\bindex\b/,
      /\bestimate\b/,
    ])
  ) {
    return "analytics_trends";
  }
  if (
    matchesAny(text, [
      /\blive\b/,
      /\bliveroom\b/,
      /\blive room\b/,
      /\bwebcast\b/,
      /\bgift\b/,
    ])
  ) {
    return "live";
  }
  if (
    matchesAny(text, [
      /\bcomment/,
      /\brepl(?:y|ies)\b/,
      /\bdanmaku\b/,
      /\bbullet chat\b/,
      /\bdiscussion\b/,
    ])
  ) {
    return "comments";
  }
  if (
    matchesAny(text, [
      /\bfollowers?\b/,
      /\bfollowing\b/,
      /\bfans?\b/,
      /\bfriends?\b/,
      /\bsocial[_-]?graph\b/,
    ])
  ) {
    return "social_graph";
  }
  if (
    matchesAny(text, [
      /\bsearch/,
      /\bsuggest/,
      /\bautocomplete\b/,
      /\blookup\b/,
      /\bfeed\b/,
      /\brecommend/,
      /\bdiscover/,
      /\bexplore\b/,
      /\bhot\b/,
    ])
  ) {
    return "search_discovery";
  }
  if (
    matchesAny(text, [
      /\bdownload/,
      /\bplay url\b/,
      /\baudio url\b/,
      /\bimage url\b/,
      /\bstream url\b/,
      /\bwatermark\b/,
    ])
  ) {
    return "media_download";
  }
  if (
    matchesAny(text, [
      /\bhashtag\b/,
      /\bchallenge\b/,
      /\btopic\b/,
      /\bmusic\b/,
      /\bsound\b/,
      /\baudio\b/,
      /\bsong\b/,
      /\blocation\b/,
      /\bkeyword\b/,
    ])
  ) {
    return "taxonomy";
  }
  if (
    matchesAny(text, [
      /\bprofile\b/,
      /\bauthor\b/,
      /\bcreator\b/,
      /\bblogger\b/,
      /\binfluencer\b/,
      /\buser\b/,
      /\baccount\b/,
      /\bchannel\b/,
      /\bkol\b/,
    ])
  ) {
    return "profile_creator";
  }
  if (
    matchesAny(text, [
      /\bvideo/,
      /\baweme\b/,
      /\breels?\b/,
      /\bshorts?\b/,
      /\bitem\b/,
      /\bnotes?\b/,
      /\bposts?\b/,
      /\barticle\b/,
      /\bstory\b/,
      /\bcontent\b/,
      /\bmedia\b/,
      /\bimages?\b/,
      /\bphotos?\b/,
      /\bcollections?\b/,
    ])
  ) {
    return "content";
  }
  if (
    matchesAny(text, [
      /\bparse\b/,
      /\bresolve\b/,
      /\bconvert\b/,
      /\bgenerate\b/,
      /\bencrypt\b/,
      /\bdecrypt\b/,
      /\bsignature\b/,
      /\bversion\b/,
      /\bdemo\b/,
      /\bshortcut\b/,
      /\bhybrid\b/,
    ])
  ) {
    return "utility";
  }
  return "other";
}
