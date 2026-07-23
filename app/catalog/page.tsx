import type { Metadata } from "next";
import CatalogClient from "./CatalogClient";
import "../styles/catalog.css";

export const metadata: Metadata = {
  title: "API 市场",
  description:
    "浏览 RelayBase 的 1,025 个 TikHub 参考端点，按平台、TikHub 官方分类、RelayBase 归一化类型、方法与调用表面筛选，并查看参数、示例和参考价格。",
};

export default function CatalogPage() {
  return <CatalogClient />;
}
