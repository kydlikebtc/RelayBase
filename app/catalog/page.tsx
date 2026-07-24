import type { Metadata } from "next";
import CatalogClient from "./CatalogClient";
import "../styles/catalog.css";

export const metadata: Metadata = {
  title: "API 市场",
  description:
    "浏览当前部署已同步和审核的 RelayBase API 服务，按平台、能力分类、数据类型、方法与调用表面筛选。",
};

export default function CatalogPage() {
  return <CatalogClient />;
}
