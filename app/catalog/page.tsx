import type { Metadata } from "next";
import CatalogClient from "./CatalogClient";
import "../styles/catalog.css";

export const metadata: Metadata = {
  title: "接口目录",
  description:
    "浏览 RelayBase 当前开放的只读数据接口，按平台筛选并查看每次成功请求的公开价格。",
};

export default function CatalogPage() {
  return <CatalogClient />;
}
