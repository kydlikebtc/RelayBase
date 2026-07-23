import type { Metadata } from "next";
import { AdminClient } from "./AdminClient";
import "../styles/admin.css";

export const metadata: Metadata = {
  title: "运营管理后台",
  description: "管理 RelayBase 用户、调用数据、接口目录、定价与支付复核。",
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminPage() {
  return <AdminClient />;
}
