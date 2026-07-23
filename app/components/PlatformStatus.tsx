"use client";

import { useEffect, useState } from "react";

type PlatformMode = "checking" | "sandbox" | "partial" | "live" | "unknown";

const labels: Record<PlatformMode, string> = {
  checking: "检查服务状态",
  sandbox: "安全沙盒",
  partial: "部分能力已启用",
  live: "服务运行中",
  unknown: "状态未知",
};

export function PlatformStatus({ className }: { className: string }) {
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
      title={labels[mode]}
    >
      <span className="status-dot" aria-hidden="true" />
      {labels[mode]}
    </span>
  );
}
