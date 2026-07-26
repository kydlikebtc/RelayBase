"use client";

import { useEffect, useState } from "react";

type PaymentState = "checking" | "available" | "unavailable";

type PricingPaymentOptionsProps = {
  locale: "en" | "zh";
  recommended: string;
  topupButton: string;
  topupFineprint: string;
  topups: readonly (readonly [string, string, string])[];
};

export function PricingPaymentOptions({
  locale,
  recommended,
  topupButton,
  topupFineprint,
  topups,
}: PricingPaymentOptionsProps) {
  const [state, setState] = useState<PaymentState>("checking");

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
          capabilities?: { paymentsEnabled?: unknown };
        };
        setState(
          payload.capabilities?.paymentsEnabled === true
            ? "available"
            : "unavailable",
        );
      })
      .catch((error: unknown) => {
        if (
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setState("unavailable");
        }
      });
    return () => controller.abort();
  }, []);

  const unavailable = state !== "available";
  const statusTitle =
    state === "checking"
      ? locale === "zh"
        ? "正在核对充值通道"
        : "Checking top-up availability"
      : unavailable
        ? locale === "zh"
          ? "充值通道暂未开放"
          : "Top-ups are not available yet"
        : locale === "zh"
          ? "充值通道已开放"
          : "Top-ups are available";
  const statusBody = unavailable
    ? locale === "zh"
      ? "当前页面只说明计价与结算方式。商业授权、支付服务商和自动对账全部就绪后，充值按钮才会开放。"
      : "This page currently explains pricing and settlement only. Top-up actions open after commercial clearance, payment-provider setup and reconciliation are all ready."
    : locale === "zh"
      ? "充值单由服务端创建并确认到账，浏览器不会直接修改余额。"
      : "Top-up orders are created and confirmed by the server; the browser never changes balance directly.";

  return (
    <>
      <div
        className={`runtime-capability-banner ${
          unavailable ? "is-unavailable" : "is-available"
        }`}
        role="status"
      >
        <span aria-hidden="true">{unavailable ? "!" : "✓"}</span>
        <div>
          <strong>{statusTitle}</strong>
          <p>{statusBody}</p>
        </div>
      </div>
      <div className="topup-grid">
        {topups.map(([amount, label, note], index) => (
          <article
            className={`topup-card${index === 2 ? " topup-featured" : ""}`}
            key={amount}
          >
            {index === 2 ? (
              <span className="topup-badge">{recommended}</span>
            ) : null}
            <span className="topup-label">{label}</span>
            <strong>{amount}</strong>
            <p>{note}</p>
            <ul>
              <li>USDT · TRC20</li>
              <li>USDT · ERC20</li>
              <li>USDC · Base</li>
            </ul>
            {unavailable ? (
              <span
                className={`button ${
                  index === 2 ? "button-lime" : "button-dark"
                } is-disabled`}
                aria-disabled="true"
              >
                {state === "checking"
                  ? locale === "zh"
                    ? "检查中"
                    : "Checking"
                  : locale === "zh"
                    ? "暂未开放"
                    : "Not available yet"}
              </span>
            ) : (
              <a
                className={`button ${
                  index === 2 ? "button-lime" : "button-dark"
                }`}
                href="/console/billing"
              >
                {topupButton} {amount}
                <span aria-hidden="true">→</span>
              </a>
            )}
          </article>
        ))}
      </div>
      <p className="topup-fineprint">{topupFineprint}</p>
    </>
  );
}
