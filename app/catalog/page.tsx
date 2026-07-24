import type { Metadata } from "next";
import CatalogClient from "./CatalogClient";
import "../styles/catalog.css";

export const metadata: Metadata = {
  title: "数据市场",
  description:
    "发现、比较并调用经过审核的多平台数据产品，按平台、数据分类、调用方式、价格与可用状态筛选。",
};

export default function CatalogPage() {
  return <CatalogClient />;
}
