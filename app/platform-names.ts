import type { Locale } from "./locale";

const platformNames: Record<
  string,
  {
    en: string;
    zh: string;
  }
> = {
  bilibili: { en: "Bilibili", zh: "哔哩哔哩" },
  demo: { en: "Demo", zh: "演示" },
  douyin: { en: "Douyin", zh: "抖音" },
  health: { en: "Health", zh: "健康检查" },
  hybrid: { en: "Hybrid", zh: "混合服务" },
  instagram: { en: "Instagram", zh: "Instagram" },
  ios_shortcut: { en: "iOS Shortcut", zh: "iOS 快捷指令" },
  kuaishou: { en: "Kuaishou", zh: "快手" },
  lemon8: { en: "Lemon8", zh: "Lemon8" },
  linkedin: { en: "LinkedIn", zh: "LinkedIn" },
  net_ease_cloud_music: { en: "NetEase Cloud Music", zh: "网易云音乐" },
  netease_cloud_music: { en: "NetEase Cloud Music", zh: "网易云音乐" },
  pipixia: { en: "Pipixia", zh: "皮皮虾" },
  reddit: { en: "Reddit", zh: "Reddit" },
  sora2: { en: "Sora 2", zh: "Sora 2" },
  telegram: { en: "Telegram", zh: "Telegram" },
  temp_mail: { en: "Temp Mail", zh: "临时邮箱" },
  threads: { en: "Threads", zh: "Threads" },
  tiktok: { en: "TikTok", zh: "TikTok" },
  toutiao: { en: "Toutiao", zh: "今日头条" },
  twitter: { en: "X / Twitter", zh: "X / Twitter" },
  wechat_channels: { en: "WeChat Channels", zh: "微信视频号" },
  wechat_mp: { en: "WeChat Official Accounts", zh: "微信公众号" },
  wechat_search: { en: "WeChat Search", zh: "微信搜索" },
  weibo: { en: "Weibo", zh: "微博" },
  xiaohongshu: { en: "Xiaohongshu", zh: "小红书" },
  xigua: { en: "Xigua Video", zh: "西瓜视频" },
  youtube: { en: "YouTube", zh: "YouTube" },
  zhihu: { en: "Zhihu", zh: "知乎" },
};

function humanizePlatform(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "ios") return "iOS";
      if (lower === "api") return "API";
      return `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`;
    })
    .join(" ");
}

export function platformDisplayName(
  value: string,
  sourceLabel: string | null | undefined,
  locale: Locale,
): string {
  const normalized = value.trim().toLowerCase();
  const known = platformNames[normalized];
  if (known) return known[locale];

  const label = sourceLabel?.trim() ?? "";
  const slashParts = label
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (slashParts.length > 1) {
    const preferred = locale === "zh" ? slashParts[0] : slashParts.at(-1);
    if (preferred) return preferred;
  }
  if (label && (locale === "zh" || !/[\u3400-\u9FFF]/.test(label))) {
    return label;
  }
  return humanizePlatform(value);
}
