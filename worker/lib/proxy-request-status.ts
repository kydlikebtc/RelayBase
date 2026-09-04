export const PROXY_REQUEST_STATUSES = [
  "processing",
  "charged",
  "completed",
  "refunded",
  "reconciled",
  "rate_limited",
  "abandoned",
] as const;

export type ProxyRequestStatus = (typeof PROXY_REQUEST_STATUSES)[number];

export const TERMINAL_PROXY_REQUEST_STATUSES: readonly ProxyRequestStatus[] = [
  "completed",
  "refunded",
  "reconciled",
  "rate_limited",
  "abandoned",
];

export function isProxyRequestStatus(
  value: unknown,
): value is ProxyRequestStatus {
  return (
    typeof value === "string" &&
    (PROXY_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

export function isTerminalProxyRequestStatus(
  status: ProxyRequestStatus,
): boolean {
  return TERMINAL_PROXY_REQUEST_STATUSES.includes(status);
}

export function terminalProxyRequestStatusSql(): string {
  return TERMINAL_PROXY_REQUEST_STATUSES.map((status) => `'${status}'`).join(
    ", ",
  );
}
