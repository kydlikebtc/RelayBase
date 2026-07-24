"use client";

import { useEffect, useState } from "react";
import type { Locale } from "../locale";

type PlatformMode = "checking" | "sandbox" | "partial" | "live" | "unknown";

const labels: Record<Locale, Record<PlatformMode, string>> = {
  en: {
    checking: "Checking status",
    sandbox: "Operational",
    partial: "Partially available",
    live: "Operational",
    unknown: "Status unavailable",
  },
  zh: {
    checking: "检查状态",
    sandbox: "服务正常",
    partial: "部分可用",
    live: "服务正常",
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
        const payload = (await response.json()) as { mode?: unknown };
        if (
          payload.mode === "sandbox" ||
          payload.mode === "partial" ||
          payload.mode === "live"
        ) {
          setMode(payload.mode);
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
