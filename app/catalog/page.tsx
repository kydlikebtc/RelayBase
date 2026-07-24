import type { Metadata } from "next";
import { getLocale } from "../locale";
import CatalogClient from "./CatalogClient";
import "../styles/catalog.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return locale === "zh"
    ? {
        title: "数据市场",
        description:
          "发现、比较并调用经过审核的多平台数据产品，按平台、数据分类、调用方式、价格与可用状态筛选。",
      }
    : {
        title: "Data market",
        description:
          "Discover, compare and call curated multi-platform data products by platform, type, method, price and availability.",
      };
}

export default async function CatalogPage() {
  const locale = await getLocale();
  return <CatalogClient locale={locale} />;
}
