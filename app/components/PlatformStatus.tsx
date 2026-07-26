"use client";

import { useEffect, useState } from "react";
import type { Locale } from "../locale";

type PlatformMode =
  | "checking"
  | "sandbox"
  | "partial"
  | "live"
  | "configuring"
  | "unknown";

const labels: Record<Locale, Record<PlatformMode, string>> = {
  en: {
    checking: "Checking status",
    sandbox: "Sandbox preview",
    partial: "Partially available",
    live: "Operational",
    configuring: "Configuration incomplete",
    unknown: "Status unavailable",
  },
  zh: {
    checking: "检查状态",
    sandbox: "沙盒预览",
    partial: "部分可用",
    live: "服务正常",
    configuring: "配置未完成",
    unknown: "状态不可用",
  },
};

export function PlatformStatus({
  className,
  locale,
}: {
  className: string;
  locale: Locale;
}) {
  const [mode, setMode] = useState<PlatformMode>("checking");

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/health", {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("health check failed");
        const payload = (await response.json()) as {
          mode?: unknown;
          ready?: unknown;
        };
        if (
          payload.mode === "sandbox" ||
          payload.mode === "partial" ||
          payload.mode === "live"
        ) {
          if (payload.ready === true && payload.mode === "live") {
            setMode("live");
          } else if (payload.mode === "sandbox") {
            setMode("sandbox");
          } else if (payload.mode === "partial") {
            setMode("partial");
          } else {
            setMode("configuring");
          }
          return;
        }
        setMode("unknown");
      })
      .catch((error: unknown) => {
        if (
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setMode("unknown");
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <span
      className={`${className} platform-status platform-status-${mode}`}
      title={labels[locale][mode]}
    >
      <span className="status-dot" aria-hidden="true" />
      {labels[locale][mode]}
    </span>
  );
}
