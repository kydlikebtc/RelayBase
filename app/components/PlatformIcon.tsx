import type { CSSProperties } from "react";
import type { IconType } from "react-icons";
import { FaLinkedinIn } from "react-icons/fa6";
import {
  FiActivity,
  FiDatabase,
  FiGlobe,
  FiLayers,
  FiMail,
} from "react-icons/fi";
import {
  SiApple,
  SiBilibili,
  SiBytedance,
  SiInstagram,
  SiKuaishou,
  SiReddit,
  SiSinaweibo,
  SiTelegram,
  SiThreads,
  SiTiktok,
  SiWechat,
  SiX,
  SiXiaohongshu,
  SiYoutube,
  SiZhihu,
} from "react-icons/si";

type PlatformBrand = {
  color: string;
  icon: IconType;
};

const platformBrands: Record<string, PlatformBrand> = {
  bilibili: { color: "#00a1d6", icon: SiBilibili },
  demo: { color: "#6f6b63", icon: FiDatabase },
  douyin: { color: "#161823", icon: SiTiktok },
  health: { color: "#6a8f5e", icon: FiActivity },
  hybrid: { color: "#a77d5b", icon: FiLayers },
  instagram: { color: "#e4405f", icon: SiInstagram },
  ios_shortcut: { color: "#111111", icon: SiApple },
  kuaishou: { color: "#ff5000", icon: SiKuaishou },
  lemon8: { color: "#3257ff", icon: SiBytedance },
  linkedin: { color: "#0a66c2", icon: FaLinkedinIn },
  pipixia: { color: "#3257ff", icon: SiBytedance },
  reddit: { color: "#ff4500", icon: SiReddit },
  telegram: { color: "#26a5e4", icon: SiTelegram },
  temp_mail: { color: "#a77d5b", icon: FiMail },
  threads: { color: "#111111", icon: SiThreads },
  tiktok: { color: "#161823", icon: SiTiktok },
  toutiao: { color: "#3257ff", icon: SiBytedance },
  twitter: { color: "#111111", icon: SiX },
  wechat_channels: { color: "#07c160", icon: SiWechat },
  wechat_mp: { color: "#07c160", icon: SiWechat },
  wechat_search: { color: "#07c160", icon: SiWechat },
  weibo: { color: "#e6162d", icon: SiSinaweibo },
  xiaohongshu: { color: "#ff2442", icon: SiXiaohongshu },
  xigua: { color: "#3257ff", icon: SiBytedance },
  youtube: { color: "#ff0000", icon: SiYoutube },
  zhihu: { color: "#0084ff", icon: SiZhihu },
};

export function PlatformIcon({
  platform,
  className = "",
}: {
  platform: string;
  className?: string;
}) {
  const brand = platformBrands[platform] ?? {
    color: "#6f6b63",
    icon: FiGlobe,
  };
  const Icon = brand.icon;
  const style = {
    "--platform-brand-color": brand.color,
  } as CSSProperties;

  return (
    <span
      className={`platform-brand-icon ${className}`.trim()}
      style={style}
      aria-hidden="true"
    >
      <Icon focusable="false" />
    </span>
  );
}
