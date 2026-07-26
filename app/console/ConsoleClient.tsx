"use client";

import type { FormEvent, MouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatGPTUser } from "../chatgpt-auth";
import type { Locale } from "../locale";
import { platformDisplayName } from "../platform-names";

type ApiKeyRecord = {
  id: string;
  label: string;
  prefix: string;
  rateLimitRps: number;
  rateLimitBurst: number;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

type PaymentRecord = {
  id: string;
  amountUsdMicros: number;
  payCurrency: string;
  payAmount: string | null;
  payAddress: string | null;
  invoiceUrl: string | null;
  status: string;
  creditedUsdMicros: number;
  reversedUsdMicros: number;
  reviewReason: string | null;
  reviewStatus: string | null;
  createdAt: string;
  updatedAt: string;
};

type CallRecord = {
  id: string;
  method: string;
  path: string;
  platform: string;
  statusCode: number;
  costUsdMicros: number;
  refunded: boolean;
  latencyMs: number;
  customerRequestCount: number;
  upstreamAttemptCount: number;
  targetCount: number;
  returnedItemCount: number | null;
  paginationUnitCount: number;
  createdAt: string;
};

type DashboardData = {
  user: {
    email: string;
    displayName: string;
  };
  balanceUsdMicros: number;
  capabilities: {
    databaseConfigured: boolean;
    configurationValid: boolean;
    legalReviewConfirmed: boolean;
    resellerAuthorized: boolean;
    commercialClearanceConfirmed: boolean;
    proxyEnabled: boolean;
    paymentsEnabled: boolean;
    adminConfigured: boolean;
    authenticationConfigured: boolean;
    productionAuthenticationConfigured: boolean;
    googleAuthenticationConfigured: boolean;
    walletAuthenticationConfigured: boolean;
    trustedSitesIdentityConfigured: boolean;
    schemaReady: boolean;
    taxonomyReady: boolean;
    catalogReady: boolean;
    x402Enabled: boolean;
    x402Configured: boolean;
    x402Available: boolean;
    x402SchemaReady: boolean;
    x402Mode: "live" | "disabled" | "unconfigured";
    x402Missing: string[];
  };
  stats: {
    calls30d: number;
    spend30dUsdMicros: number;
    successRate: number;
  };
  rateLimits: {
    account: {
      rps: number;
      burst: number;
    };
  };
  usage: {
    periodDays: 30;
    totalCalls30d: number;
    prepaidCalls30d: number;
    x402Calls30d: number;
    prepaidSpend30dUsdMicros: number;
    x402Settled30dUsdMicros: number;
    x402SettledBatches30d: number;
    x402PendingBatches: number;
    daily: Array<{
      day: string;
      prepaidCalls: number;
      x402Calls: number;
    }>;
  };
  x402: {
    runtime: {
      available: boolean;
      enabled: boolean;
      configured: boolean;
      mode: "live" | "disabled" | "unconfigured";
    };
    historyScope: {
      kind: "signed_in_wallet" | "wallet_not_linked";
      walletAddress: string | null;
    };
  };
  keys: ApiKeyRecord[];
  payments: PaymentRecord[];
  calls: CallRecord[];
};

type CreatedKey = {
  id: string;
  label: string;
  prefix: string;
  secret: string;
  rateLimitRps: number;
  rateLimitBurst: number;
  createdAt: string;
};

type PaymentInvoice = {
  id: string;
  status: string;
  payAddress: string | null;
  payAmount: number | string | null;
  payCurrency: string;
  invoiceUrl: string | null;
};

type ApiErrorShape = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

type JsonRecord = Record<string, unknown>;

type SessionUser = {
  displayName: string;
  email: string | null;
  walletAddress: string | null;
  provider: string;
};

type AuthMeResponse = {
  user: SessionUser;
};

type X402Batch = {
  id: string;
  endpoint: string;
  status: string;
  verifiedQuantity: number;
  unitPriceUsdMicros: number;
  amountUsdcAtomic: number;
  executionMode: "native_batch" | "fanout";
  capabilityRevision: number;
  plannedUpstreamRequests: number;
  actualUpstreamAttempts: number;
  returnedItemCount: number | null;
  capacityGroupId: string | null;
  network: string;
  asset: string;
  payer: string | null;
  transaction: string | null;
  paymentStatus: string;
  revenueStatus: string;
  balanceImpactUsdMicros: 0;
  failureCode: string | null;
  quotedAt: string;
  expiresAt: string;
  settledAt: string | null;
  revenueRecognizedAt: string | null;
  executionStartedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

type X402HistoryResponse = {
  scope: {
    kind: "signed_in_wallet" | "wallet_not_linked";
    walletAddress: string | null;
  };
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
  batches: X402Batch[];
};

export type ConsoleWorkspace =
  | "dashboard"
  | "keys"
  | "billing"
  | "x402";

const amountOptions = [10, 25, 50, 100] as const;
const currencyOptions = [
  { value: "usdttrc20", label: "USDT · TRC20" },
  { value: "usdterc20", label: "USDT · ERC20" },
  { value: "usdcbase", label: "USDC · Base" },
] as const;

const consoleCopy = {
  en: {
    requestFailed: (status: number) => `Request failed (HTTP ${status})`,
    sessionExpired: "Your session has expired. Sign in again.",
    emptyResponse: "The service returned an empty response. Try again shortly.",
    invalidDashboard:
      "The console returned an invalid data shape. Refresh and contact support if it continues.",
    never: "Never",
    dashboardLoadFailed: "The console could not load account data.",
    sessionCheckFailed: (status: number) =>
      `Session check failed (HTTP ${status}).`,
    invalidSession: "The sign-in session returned unverifiable data.",
    sessionUnknown: "The current sign-in state could not be confirmed.",
    keyCreated:
      "API Key created. Copy it now; the full secret will not be shown again.",
    keyCreateFailed: "API Key creation failed.",
    revokeConfirm: (label: string) =>
      `Revoke “${label}”? Requests using this Key will fail immediately.`,
    keyRevoked: (label: string) => `“${label}” was revoked.`,
    keyRevokeFailed: "API Key revocation failed.",
    invoiceCreated:
      "Top-up order created. Pay the exact asset, network and amount shown.",
    invoiceCreateFailed: "Top-up order creation failed.",
    signoutFailed: (status: number) => `Sign out failed (HTTP ${status}).`,
    invalidSignout: "The sign-out service returned an invalid response.",
    signoutFallback: "Sign out failed.",
    copyFailed: "Copy failed. Select and copy the value manually.",
    checkingAccount: "Checking account",
    signedOutUser: "Signed-out user",
    console: "Console",
    syncAfterLogin: "Sign in to sync account data",
    signingOut: "Signing out",
    signOut: "Sign out",
    checking: "Checking",
    signIn: "Sign in",
    checkingSessionTitle: "Confirming your sign-in session.",
    checkingSessionBody:
      "The console will load the matching account as soon as the session check completes.",
    loginTitle: "Sign in to load balance, Keys and the request ledger.",
    loginBody:
      "Use Google, an EVM wallet or a ChatGPT-managed identity. Signing in does not top up your balance or expose source credentials to the browser.",
    chooseLogin: "Choose a sign-in method",
    retry: "Retry",
    closeNotice: "Close notification",
    workspaceNavigation: "Console navigation",
    developerWorkspace: "Developer workspace",
    workspaces: {
      dashboard: {
        label: "Dashboard",
        eyebrow: "WORKSPACE / DASHBOARD",
        description:
          "Monitor account health, API usage and the actions that keep your integration moving.",
      },
      keys: {
        label: "API Keys",
        eyebrow: "ACCESS / API KEYS",
        description:
          "Create, review and revoke the credentials used by your server-side integrations.",
      },
      billing: {
        label: "Top-up & billing",
        eyebrow: "FUNDS / BILLING",
        description:
          "Fund your account, follow payment status and review recent balance activity.",
      },
      x402: {
        label: "x402 batches",
        eyebrow: "AGENT PAYMENTS / X402",
        description:
          "Look up wallet-paid Base USDC batches, settlement receipts and execution status.",
      },
    },
    navDescriptions: {
      dashboard: "Usage and account health",
      keys: "Credentials and access",
      billing: "Balance and payments",
      x402: "Wallet batches and receipts",
    },
    resources: "Resources",
    dataMarket: "Data market",
    documentation: "Documentation",
    accountOverview: "Account overview",
    availableBalance: "Available balance",
    calls30d: "30-day calls",
    spend30d: "30-day spend",
    successRate: "Success rate",
    quickActions: "Quick actions",
    browseData: "Browse data products",
    browseDataBody: "Find a live endpoint by platform and category.",
    createFirstKey: "Create an API Key",
    createFirstKeyBody: "Issue a server-side credential for your application.",
    addFunds: "Add funds",
    addFundsBody: "Top up the balance used for metered API calls.",
    gettingStarted: "Integration checklist",
    checklistKey: "Create an active API Key",
    checklistBalance: "Fund the account balance",
    checklistRequest: "Send the first API request",
    complete: "Complete",
    nextStep: "Next step",
    accountStatus: "Account status",
    apiAccess: "API access",
    ready: "Ready",
    actionRequired: "Action required",
    catalogAccess: "Data catalog",
    billingChannel: "Billing channel",
    enabled: "Enabled",
    unavailable: "Unavailable",
    activeKeys: "Active Keys",
    keysUsed: "Keys used",
    keysUnused: "Never used",
    credentialInventory: "Credential inventory",
    credentialHelp:
      "Keys authorize billable requests. Keep them in a server-side secret manager and rotate any credential that may have been exposed.",
    securityPractices: "Credential safety",
    securityItems: [
      "Use a separate Key for each environment.",
      "Never place a Key in client-side code or public repositories.",
      "Revoke a Key immediately when access is no longer required.",
    ],
    keyStatus: "Key status",
    requestLimit: "Request limit",
    accountLimit: "Account limit",
    requestLimitHint:
      "All active Keys share the account ceiling; creating more Keys does not add throughput.",
    keyName: "Name",
    keyPrefix: "Key prefix",
    lastUsed: "Last used",
    actions: "Actions",
    active: "Active",
    recentCredits: "Recent credits",
    openOrders: "Open orders",
    paymentActivity: "Payment activity",
    billingHelpTitle: "How account funding works",
    billingHelp:
      "Create a top-up order, send the exact asset on the selected network, then wait for on-chain confirmation. Credited funds become available automatically.",
    noOpenOrders: "No open orders",
    newKeyLabel: "New Key name",
    keyPlaceholder: "For example: Production",
    creating: "Creating…",
    createKey: "＋ Create Key",
    showOnce: "Shown once",
    closeNewKey: "Close new Key notice",
    saveSecret:
      "Copy it now and store it in a server-side secret manager. The full value cannot be viewed again.",
    keyCopied: "API Key copied.",
    copy: "Copy",
    loadingKeys: "Loading Keys…",
    created: "Created",
    used: "Used",
    revoking: "Revoking…",
    revoke: "Revoke",
    noKeys: "No API Keys yet.",
    loginForKeys: "Sign in to manage API Keys.",
    topupTitle: "Balance top-up",
    topupAmount: "Top-up amount (USD)",
    assetNetwork: "Payment asset / network",
    creatingInvoice: "Creating top-up order…",
    topup: (amount: number) => `Top up $${amount}`,
    clearanceClosed:
      "Live top-ups are unavailable until the required payment-method clarification is recorded.",
    topupUnavailable:
      "Top-ups are not available yet and will open when proxy, merchant and compliance readiness are complete.",
    topupSafety:
      "Send funds only to the network and address shown on the order. Balance changes after on-chain confirmation.",
    invoiceTitle: "Top-up order created",
    closeInvoice: "Close top-up order",
    amountDue: "Amount due",
    receivingAddress: "Receiving address",
    addressPending: "Waiting for the payment service to generate an address",
    addressCopied: "Payment address copied.",
    copyAddress: "Copy address",
    currentStatus: "Current status",
    balanceAutoUpdate: "Balance updates automatically after confirmation",
    openInvoice: "Open full top-up order ↗",
    recentRequests: "Recent requests",
    apiDocs: "API docs ↗",
    time: "Time",
    request: "Request",
    platform: "Platform",
    status: "Status",
    latency: "Latency",
    cost: "Cost",
    refunded: "Refunded",
    noRequestsUser:
      "Create a Key and send your first request. Status, latency and cost will appear here.",
    noRequestsGuest: "Sign in to view real request records.",
    quickstart: "View quickstart →",
    consoleLogin: "Sign in to console →",
    recentTopups: "Recent top-ups",
    refreshing: "Refreshing…",
    refreshStatus: "Refresh status ↻",
    credited: "Credited",
    reversed: "Reversed",
    continuePayment: "Continue payment",
    noTopups: "No top-up records yet.",
    loginForTopups: "Sign in to view top-up status.",
  },
  zh: {
    requestFailed: (status: number) => `请求失败（HTTP ${status}）`,
    sessionExpired: "登录状态已失效，请重新登录。",
    emptyResponse: "服务返回了空响应，请稍后重试。",
    invalidDashboard: "控制台数据格式异常，请刷新重试；若问题持续存在，请联系支持。",
    never: "从未",
    dashboardLoadFailed: "控制台数据加载失败。",
    sessionCheckFailed: (status: number) => `会话检查失败（HTTP ${status}）。`,
    invalidSession: "登录会话返回了无法验证的数据。",
    sessionUnknown: "无法确认当前登录状态。",
    keyCreated: "API Key 已创建。请立即复制，密钥不会再次完整显示。",
    keyCreateFailed: "密钥创建失败。",
    revokeConfirm: (label: string) =>
      `确定撤销“${label}”吗？使用该密钥的请求将立即失败。`,
    keyRevoked: (label: string) => `“${label}”已撤销。`,
    keyRevokeFailed: "密钥撤销失败。",
    invoiceCreated: "充值单已创建，请严格按指定币种、网络和数量支付。",
    invoiceCreateFailed: "充值单创建失败。",
    signoutFailed: (status: number) => `退出失败（HTTP ${status}）。`,
    invalidSignout: "退出接口返回了无法验证的数据。",
    signoutFallback: "退出失败。",
    copyFailed: "复制失败，请手动选择并复制。",
    checkingAccount: "正在确认账户",
    signedOutUser: "未登录用户",
    console: "控制台",
    syncAfterLogin: "登录后同步账户数据",
    signingOut: "退出中",
    signOut: "退出",
    checking: "检查中",
    signIn: "登录",
    checkingSessionTitle: "正在确认你的登录会话。",
    checkingSessionBody: "会话检查完成后，控制台会自动加载对应账户的数据。",
    loginTitle: "登录后加载你的余额、密钥和请求账本。",
    loginBody:
      "支持 Google、EVM 钱包与 ChatGPT 托管身份。登录不会自动充值，也不会向浏览器暴露任何来源凭据。",
    chooseLogin: "选择登录方式",
    retry: "重试",
    closeNotice: "关闭提示",
    workspaceNavigation: "控制台导航",
    developerWorkspace: "开发者工作区",
    workspaces: {
      dashboard: {
        label: "概览",
        eyebrow: "工作区 / 概览",
        description: "集中查看账户状态、API 使用情况，以及推进接入所需的关键操作。",
      },
      keys: {
        label: "API Key",
        eyebrow: "访问控制 / API KEY",
        description: "创建、检查和撤销服务端集成使用的访问凭据。",
      },
      billing: {
        label: "充值与账单",
        eyebrow: "资金 / 账单",
        description: "充值账户、跟踪付款状态，并查看近期余额变动记录。",
      },
      x402: {
        label: "x402 批次",
        eyebrow: "AGENT 支付 / X402",
        description: "查询由调用方钱包支付的 Base USDC 批次、结算回执与执行状态。",
      },
    },
    navDescriptions: {
      dashboard: "使用情况与账户状态",
      keys: "凭据与访问控制",
      billing: "余额与付款记录",
      x402: "钱包批次与结算回执",
    },
    resources: "常用资源",
    dataMarket: "数据市场",
    documentation: "开发文档",
    accountOverview: "账户概览",
    availableBalance: "可用余额",
    calls30d: "30 天调用",
    spend30d: "30 天支出",
    successRate: "成功率",
    quickActions: "快捷操作",
    browseData: "浏览数据产品",
    browseDataBody: "按平台和分类查找当前可用的数据接口。",
    createFirstKey: "创建 API Key",
    createFirstKeyBody: "为你的服务端应用签发独立访问凭据。",
    addFunds: "充值余额",
    addFundsBody: "为按量计费的 API 调用补充可用余额。",
    gettingStarted: "接入检查清单",
    checklistKey: "创建一个有效的 API Key",
    checklistBalance: "为账户充值",
    checklistRequest: "发出第一次 API 请求",
    complete: "已完成",
    nextStep: "下一步",
    accountStatus: "账户状态",
    apiAccess: "API 访问",
    ready: "就绪",
    actionRequired: "需要操作",
    catalogAccess: "数据目录",
    billingChannel: "充值通道",
    enabled: "已启用",
    unavailable: "暂不可用",
    activeKeys: "有效 Key",
    keysUsed: "已使用 Key",
    keysUnused: "从未使用",
    credentialInventory: "凭据清单",
    credentialHelp:
      "API Key 用于授权计费请求。请保存在服务端密钥管理工具中；若存在泄露风险，应立即撤销并更换。",
    securityPractices: "凭据安全",
    securityItems: [
      "为生产、测试等不同环境分别创建 Key。",
      "不要把 Key 写入客户端代码或公开代码仓库。",
      "不再需要的 Key 应立即撤销。",
    ],
    keyStatus: "Key 状态",
    requestLimit: "请求限制",
    accountLimit: "账户上限",
    requestLimitHint:
      "所有有效 Key 共享账户总上限；增加 Key 数量不会叠加吞吐。",
    keyName: "名称",
    keyPrefix: "Key 前缀",
    lastUsed: "最近使用",
    actions: "操作",
    active: "有效",
    recentCredits: "近期入账",
    openOrders: "进行中订单",
    paymentActivity: "付款记录",
    billingHelpTitle: "账户充值说明",
    billingHelp:
      "创建充值单后，请按指定网络转入准确币种和数量。链上确认完成后，资金会自动计入可用余额。",
    noOpenOrders: "暂无进行中订单",
    newKeyLabel: "新密钥名称",
    keyPlaceholder: "例如：Production",
    creating: "创建中…",
    createKey: "＋ 创建 Key",
    showOnce: "只显示这一次",
    closeNewKey: "关闭新密钥提示",
    saveSecret: "立即复制并保存到服务端密钥管理工具。离开后无法再次查看完整值。",
    keyCopied: "API Key 已复制。",
    copy: "复制",
    loadingKeys: "正在加载密钥…",
    created: "创建",
    used: "使用",
    revoking: "撤销中…",
    revoke: "撤销",
    noKeys: "还没有 API Key。",
    loginForKeys: "登录后管理你的 API Key。",
    topupTitle: "余额充值",
    topupAmount: "充值金额（USD）",
    assetNetwork: "支付币种 / 网络",
    creatingInvoice: "正在创建充值单…",
    topup: (amount: number) => `充值 $${amount}`,
    clearanceClosed:
      "真实充值尚未开放：仍需归档稳定币仅作为 API 付款方式的书面澄清。",
    topupUnavailable:
      "当前充值功能尚未开放，将在数据代理、商户与合规条件全部就绪后启用。",
    topupSafety: "只向充值单指定的网络和地址转账。链上确认前，余额不会改变。",
    invoiceTitle: "充值单已创建",
    closeInvoice: "关闭充值单",
    amountDue: "应付数量",
    receivingAddress: "收款地址",
    addressPending: "等待支付服务生成地址",
    addressCopied: "支付地址已复制。",
    copyAddress: "复制地址",
    currentStatus: "当前状态",
    balanceAutoUpdate: "到账后自动更新余额",
    openInvoice: "打开完整充值单 ↗",
    recentRequests: "最近请求",
    apiDocs: "API 文档 ↗",
    time: "时间",
    request: "请求",
    platform: "平台",
    status: "状态",
    latency: "延迟",
    cost: "费用",
    refunded: "已退回",
    noRequestsUser: "创建 Key 并发出第一条请求后，状态、延迟与费用会出现在这里。",
    noRequestsGuest: "登录后查看真实的请求记录。",
    quickstart: "查看快速开始 →",
    consoleLogin: "登录控制台 →",
    recentTopups: "最近充值",
    refreshing: "刷新中…",
    refreshStatus: "刷新状态 ↻",
    credited: "已入账",
    reversed: "已冲销",
    continuePayment: "继续支付",
    noTopups: "暂无充值记录。",
    loginForTopups: "登录后查看充值状态。",
  },
} as const;

const x402Copy = {
  en: {
    readiness: "x402 availability",
    available: "Available",
    notReady: "Not ready",
    runtimeLive: "Wallet settlement is configured and callable.",
    runtimeDisabled: "The x402 entry is not enabled.",
    runtimeUnconfigured: "Settlement configuration is incomplete.",
    runtimeBlocked: "Runtime prerequisites are not all ready.",
    targetCalls: "30-day x402 calls",
    settledAmount: "30-day wallet-settled",
    batchStatus: "30-day settled / open batches",
    batchStatusSub: "Settled 30d / Pending now",
    paymentBoundary:
      "Availability describes whether new batches can be quoted. Only a persisted Base transaction hash marks a batch as settled.",
    balanceBoundary:
      "x402 wallet payments never top up or deduct the platform balance.",
    history: "Batch history",
    historyEyebrow: "WALLET-SCOPED RECORDS",
    historyDescription:
      "Every batch paid by the wallet used for this sign-in. Use an exact batch ID for receipts from another caller wallet.",
    walletScope: "Signed-in wallet",
    noWalletScope: "No wallet linked to this sign-in",
    filter: "Status",
    filterAll: "All batches",
    filterSettled: "Settled on Base",
    filterPending: "Payment pending",
    filterFailed: "Needs attention",
    filterSucceeded: "Execution succeeded",
    batchId: "Batch",
    product: "Data product",
    quantity: "Quantity",
    amount: "Amount",
    wallet: "Wallet",
    payment: "Payment",
    execution: "Execution",
    transaction: "Base transaction",
    updated: "Updated",
    actions: "Actions",
    view: "View",
    noTransaction: "No on-chain transaction",
    notRecorded: "Not recorded",
    paymentSettled: "Settled",
    paymentPending: "Pending",
    paymentReview: "Review required",
    paymentRejected: "Rejected",
    executionSucceeded: "Succeeded",
    executionFailed: "Failed",
    executionRunning: "Executing",
    executionNotStarted: "Not started",
    quoteExpired: "Expired",
    loadingHistory: "Loading wallet batch history…",
    noHistory:
      "No x402 batches were found for the signed-in wallet and selected status.",
    noWalletHistory:
      "This account is not signed in with a wallet, so wallet-scoped history cannot be derived. Paste a batch ID to inspect a receipt.",
    page: (current: number, pages: number) => `Page ${current} of ${pages}`,
    records: "batches",
    previous: "Previous",
    next: "Next",
    lookupLabel: "Find a specific receipt",
    lookupPlaceholder: "xb_...",
    lookupButton: "Find receipt",
    lookupLoading: "Loading…",
    detail: "Batch receipt",
    detailEyebrow: "SETTLEMENT / EXECUTION",
    detailEmpty:
      "Select a history row or enter a batch ID to inspect settlement and execution evidence.",
    copyBatch: "Copy batch ID",
    batchCopied: "Batch ID copied.",
    copyWallet: "Copy wallet",
    walletCopied: "Wallet copied.",
    copyTransaction: "Copy transaction hash",
    transactionCopied: "Transaction hash copied.",
    viewTransaction: "View on BaseScan ↗",
    settlementEvidence: "Settlement evidence",
    executionEvidence: "Execution evidence",
    unitPrice: "Unit price",
    quoted: "Quoted",
    settled: "Settled",
    started: "Execution started",
    completed: "Completed",
    failureCode: "Failure code",
    receiptConfirmed:
      "A Base transaction hash is recorded. Payment settlement and execution remain separate states.",
    receiptMissing:
      "No Base transaction hash is recorded, so this batch is not presented as chain-settled.",
    runtimeClarification:
      "“Not ready” is a runtime availability state. It never means a payment settled on-chain.",
    callsChart: "Daily API usage",
    callsChartEyebrow: "30 DAYS / DAILY",
    callsChartDescription:
      "Stacked daily volume. The total equals API Key balance calls plus x402 target calls.",
    prepaidCalls: "API Key / balance",
    x402Calls: "x402 wallet",
    totalCalls: "Total calls",
    prepaidSpend: "Prepaid usage",
    x402Spend: "x402 wallet-settled",
    chartEmpty: "No calls in the last 30 days.",
  },
  zh: {
    readiness: "x402 可用状态",
    available: "当前可用",
    notReady: "当前未就绪",
    runtimeLive: "钱包结算配置完整，当前可创建新批次。",
    runtimeDisabled: "x402 入口尚未启用。",
    runtimeUnconfigured: "结算配置尚未完整。",
    runtimeBlocked: "运行所需条件尚未全部满足。",
    targetCalls: "30 天 x402 调用",
    settledAmount: "30 天钱包实结算",
    batchStatus: "30 天已结算 / 当前待处理",
    batchStatusSub: "30 天已结算 / 当前待处理",
    paymentBoundary:
      "可用状态只说明能否创建新批次；只有已持久化的 Base 交易哈希，才表示该批次已完成链上结算。",
    balanceBoundary: "x402 钱包付款不会充值或扣减平台余额。",
    history: "批次历史",
    historyEyebrow: "钱包范围记录",
    historyDescription:
      "完整展示本次登录钱包支付的批次；其他调用方钱包的回执可通过准确批次编号查询。",
    walletScope: "当前登录钱包",
    noWalletScope: "当前登录未关联钱包",
    filter: "状态筛选",
    filterAll: "全部批次",
    filterSettled: "已在 Base 结算",
    filterPending: "付款处理中",
    filterFailed: "需要处理",
    filterSucceeded: "执行成功",
    batchId: "批次",
    product: "数据产品",
    quantity: "数量",
    amount: "金额",
    wallet: "付款钱包",
    payment: "付款状态",
    execution: "执行状态",
    transaction: "Base 交易",
    updated: "更新时间",
    actions: "操作",
    view: "查看",
    noTransaction: "无链上交易",
    notRecorded: "尚未记录",
    paymentSettled: "已结算",
    paymentPending: "待付款",
    paymentReview: "需要复核",
    paymentRejected: "已拒绝",
    executionSucceeded: "执行成功",
    executionFailed: "执行失败",
    executionRunning: "执行中",
    executionNotStarted: "尚未执行",
    quoteExpired: "已过期",
    loadingHistory: "正在加载钱包批次历史…",
    noHistory: "当前登录钱包在所选状态下暂无 x402 批次。",
    noWalletHistory:
      "当前账户不是通过钱包登录，无法可靠推导钱包范围历史。你仍可粘贴批次编号查询具体回执。",
    page: (current: number, pages: number) => `第 ${current} / ${pages} 页`,
    records: "个批次",
    previous: "上一页",
    next: "下一页",
    lookupLabel: "查询指定批次回执",
    lookupPlaceholder: "xb_...",
    lookupButton: "查询回执",
    lookupLoading: "查询中…",
    detail: "批次回执",
    detailEyebrow: "结算 / 执行",
    detailEmpty: "选择历史记录或输入批次编号，查看结算与执行证据。",
    copyBatch: "复制批次编号",
    batchCopied: "批次编号已复制。",
    copyWallet: "复制钱包地址",
    walletCopied: "钱包地址已复制。",
    copyTransaction: "复制交易哈希",
    transactionCopied: "交易哈希已复制。",
    viewTransaction: "在 BaseScan 查看 ↗",
    settlementEvidence: "结算证据",
    executionEvidence: "执行证据",
    unitPrice: "单价",
    quoted: "报价时间",
    settled: "结算时间",
    started: "开始执行",
    completed: "完成时间",
    failureCode: "失败代码",
    receiptConfirmed:
      "已记录 Base 交易哈希。付款结算状态与批次执行状态仍分别呈现。",
    receiptMissing:
      "尚未记录 Base 交易哈希，因此不会将该批次显示为已完成链上结算。",
    runtimeClarification:
      "“当前未就绪”属于运行可用状态，绝不代表该批次已经链上结算。",
    callsChart: "每日调用量",
    callsChartEyebrow: "30 天 / 按日",
    callsChartDescription:
      "按日堆叠展示；总调用量等于 API Key 余额调用与 x402 目标调用之和。",
    prepaidCalls: "API Key / 余额",
    x402Calls: "x402 钱包",
    totalCalls: "总调用",
    prepaidSpend: "余额消费",
    x402Spend: "x402 钱包实结算",
    chartEmpty: "最近 30 天暂无调用。",
  },
} as const;

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function englishApiError(
  code: string | undefined,
  status: number,
): string {
  const messages: Record<string, string> = {
    authentication_required: "Sign in to continue.",
    invalid_api_key: "The API Key is invalid or has been revoked.",
    insufficient_balance: "The available balance is insufficient.",
    invalid_request: "The request is invalid.",
    invalid_payment: "The top-up request is invalid.",
    payments_not_enabled: "Top-ups are not currently available.",
    customer_rate_limit_exceeded:
      "The API Key or account request limit was reached. Respect Retry-After.",
    upstream_capacity_exhausted:
      "Safe source account or endpoint capacity is temporarily full. Respect Retry-After.",
    schema_not_ready: "Account storage is not ready. Try again shortly.",
    user_suspended: "This account is unavailable. Contact support.",
  };
  return (
    (code ? messages[code] : undefined) ??
    (status === 401
      ? consoleCopy.en.sessionExpired
      : consoleCopy.en.requestFailed(status))
  );
}

async function apiRequest<T>(
  url: string,
  locale: Locale,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & ApiErrorShape)
    | null;

  if (!response.ok) {
    const message =
      locale === "zh"
        ? (payload?.error?.message ??
          (response.status === 401
            ? consoleCopy.zh.sessionExpired
            : consoleCopy.zh.requestFailed(response.status)))
        : englishApiError(payload?.error?.code, response.status);
    throw new ApiRequestError(message, response.status);
  }

  if (!payload) {
    throw new Error(consoleCopy[locale].emptyResponse);
  }

  return payload;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isSessionUser(value: unknown): value is SessionUser {
  if (!isRecord(value)) return false;
  return (
    typeof value.displayName === "string" &&
    value.displayName.length > 0 &&
    value.displayName.length <= 320 &&
    (value.email === null ||
      (typeof value.email === "string" &&
        value.email.length > 0 &&
        value.email.length <= 320)) &&
    (value.walletAddress === null ||
      (typeof value.walletAddress === "string" &&
        /^0x[a-fA-F0-9]{40}$/.test(value.walletAddress))) &&
    typeof value.provider === "string" &&
    /^[a-z][a-z0-9_-]{0,31}$/.test(value.provider)
  );
}

function isAuthMeResponse(value: unknown): value is AuthMeResponse {
  return isRecord(value) && isSessionUser(value.user);
}

function isSignoutResponse(value: unknown): value is { ok: true } {
  return isRecord(value) && value.ok === true;
}

function isApiKeyRecord(value: unknown): value is ApiKeyRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.prefix === "string" &&
    isNonNegativeInteger(value.rateLimitRps) &&
    value.rateLimitRps >= 1 &&
    value.rateLimitRps <= 1_000 &&
    isNonNegativeInteger(value.rateLimitBurst) &&
    value.rateLimitBurst >= value.rateLimitRps &&
    value.rateLimitBurst <= 2_000 &&
    typeof value.createdAt === "string" &&
    isNullableString(value.lastUsedAt) &&
    isNullableString(value.revokedAt)
  );
}

function isPaymentRecord(value: unknown): value is PaymentRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    isNonNegativeInteger(value.amountUsdMicros) &&
    typeof value.payCurrency === "string" &&
    isNullableString(value.payAmount) &&
    isNullableString(value.payAddress) &&
    isNullableString(value.invoiceUrl) &&
    typeof value.status === "string" &&
    isNonNegativeInteger(value.creditedUsdMicros) &&
    isNonNegativeInteger(value.reversedUsdMicros) &&
    isNullableString(value.reviewReason) &&
    isNullableString(value.reviewStatus) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isCallRecord(value: unknown): value is CallRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.method === "string" &&
    typeof value.path === "string" &&
    typeof value.platform === "string" &&
    isNonNegativeInteger(value.statusCode) &&
    isNonNegativeInteger(value.costUsdMicros) &&
    typeof value.refunded === "boolean" &&
    isNonNegativeInteger(value.latencyMs) &&
    isNonNegativeInteger(value.customerRequestCount) &&
    isNonNegativeInteger(value.upstreamAttemptCount) &&
    isNonNegativeInteger(value.targetCount) &&
    (value.returnedItemCount === null ||
      isNonNegativeInteger(value.returnedItemCount)) &&
    isNonNegativeInteger(value.paginationUnitCount) &&
    typeof value.createdAt === "string"
  );
}

function isX402Batch(value: unknown): value is X402Batch {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    /^xb_[A-Za-z0-9_-]{20,80}$/.test(value.id) &&
    typeof value.endpoint === "string" &&
    typeof value.status === "string" &&
    isNonNegativeInteger(value.verifiedQuantity) &&
    isNonNegativeInteger(value.unitPriceUsdMicros) &&
    isNonNegativeInteger(value.amountUsdcAtomic) &&
    (value.executionMode === "native_batch" ||
      value.executionMode === "fanout") &&
    isNonNegativeInteger(value.capabilityRevision) &&
    value.capabilityRevision >= 1 &&
    isNonNegativeInteger(value.plannedUpstreamRequests) &&
    value.plannedUpstreamRequests >= 1 &&
    isNonNegativeInteger(value.actualUpstreamAttempts) &&
    (value.returnedItemCount === null ||
      isNonNegativeInteger(value.returnedItemCount)) &&
    isNullableString(value.capacityGroupId) &&
    typeof value.network === "string" &&
    typeof value.asset === "string" &&
    isNullableString(value.payer) &&
    isNullableString(value.transaction) &&
    typeof value.paymentStatus === "string" &&
    typeof value.revenueStatus === "string" &&
    value.balanceImpactUsdMicros === 0 &&
    isNullableString(value.failureCode) &&
    typeof value.quotedAt === "string" &&
    typeof value.expiresAt === "string" &&
    isNullableString(value.settledAt) &&
    isNullableString(value.revenueRecognizedAt) &&
    isNullableString(value.executionStartedAt) &&
    isNullableString(value.completedAt) &&
    typeof value.updatedAt === "string"
  );
}

function isX402HistoryResponse(
  value: unknown,
): value is X402HistoryResponse {
  if (!isRecord(value) || !isRecord(value.scope)) return false;
  return (
    (value.scope.kind === "signed_in_wallet" ||
      value.scope.kind === "wallet_not_linked") &&
    isNullableString(value.scope.walletAddress) &&
    isNonNegativeInteger(value.page) &&
    value.page >= 1 &&
    isNonNegativeInteger(value.limit) &&
    value.limit >= 1 &&
    isNonNegativeInteger(value.total) &&
    typeof value.hasNext === "boolean" &&
    Array.isArray(value.batches) &&
    value.batches.every(isX402Batch)
  );
}

function isDashboardData(value: unknown): value is DashboardData {
  if (!isRecord(value)) return false;

  const {
    user,
    capabilities,
    stats,
    usage,
    rateLimits,
    x402,
    keys,
    payments,
    calls,
  } = value;
  if (
    !isRecord(user) ||
    !isRecord(capabilities) ||
    !isRecord(stats) ||
    !isRecord(usage) ||
    !isRecord(rateLimits) ||
    !isRecord(rateLimits.account) ||
    !isRecord(x402) ||
    !isRecord(x402.runtime) ||
    !isRecord(x402.historyScope)
  ) {
    return false;
  }

  return (
    typeof user.email === "string" &&
    typeof user.displayName === "string" &&
    isFiniteNumber(value.balanceUsdMicros) &&
    typeof capabilities.databaseConfigured === "boolean" &&
    typeof capabilities.configurationValid === "boolean" &&
    typeof capabilities.legalReviewConfirmed === "boolean" &&
    typeof capabilities.resellerAuthorized === "boolean" &&
    typeof capabilities.commercialClearanceConfirmed === "boolean" &&
    typeof capabilities.proxyEnabled === "boolean" &&
    typeof capabilities.paymentsEnabled === "boolean" &&
    typeof capabilities.adminConfigured === "boolean" &&
    typeof capabilities.authenticationConfigured === "boolean" &&
    typeof capabilities.productionAuthenticationConfigured === "boolean" &&
    typeof capabilities.googleAuthenticationConfigured === "boolean" &&
    typeof capabilities.walletAuthenticationConfigured === "boolean" &&
    typeof capabilities.trustedSitesIdentityConfigured === "boolean" &&
    typeof capabilities.schemaReady === "boolean" &&
    typeof capabilities.taxonomyReady === "boolean" &&
    typeof capabilities.catalogReady === "boolean" &&
    typeof capabilities.x402Enabled === "boolean" &&
    typeof capabilities.x402Configured === "boolean" &&
    typeof capabilities.x402Available === "boolean" &&
    typeof capabilities.x402SchemaReady === "boolean" &&
    (capabilities.x402Mode === "live" ||
      capabilities.x402Mode === "disabled" ||
      capabilities.x402Mode === "unconfigured") &&
    Array.isArray(capabilities.x402Missing) &&
    capabilities.x402Missing.every((item) => typeof item === "string") &&
    isNonNegativeInteger(stats.calls30d) &&
    isNonNegativeInteger(stats.spend30dUsdMicros) &&
    isFiniteNumber(stats.successRate) &&
    stats.successRate >= 0 &&
    stats.successRate <= 1 &&
    isNonNegativeInteger(rateLimits.account.rps) &&
    rateLimits.account.rps >= 1 &&
    rateLimits.account.rps <= 1_000 &&
    isNonNegativeInteger(rateLimits.account.burst) &&
    rateLimits.account.burst >= rateLimits.account.rps &&
    rateLimits.account.burst <= 2_000 &&
    usage.periodDays === 30 &&
    isNonNegativeInteger(usage.totalCalls30d) &&
    isNonNegativeInteger(usage.prepaidCalls30d) &&
    isNonNegativeInteger(usage.x402Calls30d) &&
    usage.totalCalls30d ===
      usage.prepaidCalls30d + usage.x402Calls30d &&
    isNonNegativeInteger(usage.prepaidSpend30dUsdMicros) &&
    isNonNegativeInteger(usage.x402Settled30dUsdMicros) &&
    isNonNegativeInteger(usage.x402SettledBatches30d) &&
    isNonNegativeInteger(usage.x402PendingBatches) &&
    Array.isArray(usage.daily) &&
    usage.daily.every(
      (item) =>
        isRecord(item) &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(item.day)) &&
        isNonNegativeInteger(item.prepaidCalls) &&
        isNonNegativeInteger(item.x402Calls),
    ) &&
    typeof x402.runtime.available === "boolean" &&
    typeof x402.runtime.enabled === "boolean" &&
    typeof x402.runtime.configured === "boolean" &&
    (x402.runtime.mode === "live" ||
      x402.runtime.mode === "disabled" ||
      x402.runtime.mode === "unconfigured") &&
    (x402.historyScope.kind === "signed_in_wallet" ||
      x402.historyScope.kind === "wallet_not_linked") &&
    isNullableString(x402.historyScope.walletAddress) &&
    Array.isArray(keys) &&
    keys.every(isApiKeyRecord) &&
    Array.isArray(payments) &&
    payments.every(isPaymentRecord) &&
    Array.isArray(calls) &&
    calls.every(isCallRecord)
  );
}

function parseDashboardData(value: unknown, locale: Locale): DashboardData {
  if (!isDashboardData(value)) {
    throw new Error(consoleCopy[locale].invalidDashboard);
  }
  return value;
}

function formatUsd(micros: number | null | undefined, digits = 2) {
  if (micros === null || micros === undefined) return "—";
  return `$${(micros / 1_000_000).toFixed(digits)}`;
}

function formatRate(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const percent = value <= 1 ? value * 100 : value;
  return `${percent.toFixed(1)}%`;
}

function formatDate(
  value: string | null | undefined,
  locale: Locale,
  includeTime = false,
) {
  if (!value) return consoleCopy[locale].never;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    month: "2-digit",
    day: "2-digit",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function recentUsageDays(
  daily: DashboardData["usage"]["daily"] | undefined,
) {
  const values = new Map(
    (daily ?? []).map((item) => [item.day, item] as const),
  );
  const days: DashboardData["usage"]["daily"] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let offset = 29; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - offset);
    const day = date.toISOString().slice(0, 10);
    days.push(
      values.get(day) ?? {
        day,
        prepaidCalls: 0,
        x402Calls: 0,
      },
    );
  }
  return days;
}

function compactValue(value: string | null, head = 8, tail = 6) {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function x402PaymentLabel(status: string, locale: Locale) {
  const copy = x402Copy[locale];
  if (status === "settled") return copy.paymentSettled;
  if (status === "review_required") return copy.paymentReview;
  if (status === "rejected") return copy.paymentRejected;
  return copy.paymentPending;
}

function x402ExecutionLabel(status: string, locale: Locale) {
  const copy = x402Copy[locale];
  if (status === "succeeded") return copy.executionSucceeded;
  if (status === "execution_failed") return copy.executionFailed;
  if (status === "executing") return copy.executionRunning;
  if (status === "expired") return copy.quoteExpired;
  return copy.executionNotStarted;
}

function x402ExecutionClass(status: string) {
  if (status === "succeeded") return "is-success";
  if (status === "execution_failed" || status === "expired") {
    return "is-danger";
  }
  if (status === "executing") return "is-progress";
  return "is-muted";
}

function paymentStatus(status: string, locale: Locale) {
  const labels: Record<Locale, Record<string, string>> = {
    en: {
      pending: "Pending",
      waiting: "Awaiting payment",
      confirming: "Confirming",
      confirmed: "Confirmed",
      sending: "Crediting",
      partially_paid: "Underpaid",
      finished: "Credited",
      completed: "Credited",
      paid: "Credited",
      failed: "Failed",
      expired: "Expired",
      refunded: "Refunded",
      manual_review: "Manual review",
      manual_resolved: "Review resolved",
      provider_error: "Payment channel error",
      creating: "Creating",
    },
    zh: {
      pending: "待确认",
      waiting: "等待付款",
      confirming: "确认中",
      confirmed: "已确认",
      sending: "入账处理中",
      partially_paid: "金额不足",
      finished: "已到账",
      completed: "已到账",
      paid: "已到账",
      failed: "失败",
      expired: "已过期",
      refunded: "已退款",
      manual_review: "人工复核",
      manual_resolved: "复核已结案",
      provider_error: "通道异常",
      creating: "创建中",
    },
  };
  return labels[locale][status.toLowerCase()] ?? status;
}

function paymentStatusClass(status: string) {
  const normalized = status.toLowerCase().replace(/[^a-z_]/g, "");
  return normalized || "unknown";
}

function paymentReviewReason(reason: string | null, locale: Locale) {
  if (!reason) return null;
  const labels: Record<Locale, Record<string, string>> = {
    en: {
      orphan_payment: "Unmatched payment",
      order_mismatch: "Order mismatch",
      amount_mismatch: "Amount mismatch",
      currency_mismatch: "Asset mismatch",
      partial_payment: "Partial payment",
      paid_after_expiration: "Paid after expiration",
      terminal_status_conflict: "Final-status conflict",
      refund_requires_review: "Refund review",
      provider_payload_mismatch: "Payment-provider data mismatch",
      repeated_deposit: "Possible repeated payment",
      terminal_with_funds: "Funds on a finalized order",
      underpaid_finished: "Confirmed amount is insufficient",
      provider_data_mismatch: "Payment-provider data mismatch",
      partially_paid: "Partial payment",
      overpaid_finished: "Confirmed amount exceeds order",
      funds_after_manual_rejection: "Funds detected after rejection",
    },
    zh: {
      orphan_payment: "未绑定订单",
      order_mismatch: "订单绑定不一致",
      amount_mismatch: "付款金额不一致",
      currency_mismatch: "付款币种不一致",
      partial_payment: "付款金额不足",
      paid_after_expiration: "过期后付款",
      terminal_status_conflict: "终态冲突",
      refund_requires_review: "退款待复核",
      provider_payload_mismatch: "服务商数据不一致",
      repeated_deposit: "疑似重复付款",
      terminal_with_funds: "终态订单仍有到账",
      underpaid_finished: "到账金额不足",
      provider_data_mismatch: "服务商数据不一致",
      partially_paid: "部分付款",
      overpaid_finished: "到账金额超出订单",
      funds_after_manual_rejection: "拒绝结案后检测到资金",
    },
  };
  return (
    labels[locale][reason] ??
    (locale === "zh" ? "支付信息待复核" : "Payment details require review")
  );
}

function currencyLabel(currency: string) {
  return (
    currencyOptions.find((item) => item.value === currency)?.label ?? currency
  );
}

export function ConsoleClient({
  chatGPTUser,
  chatGPTSignOutPath,
  locale,
  workspace,
}: {
  chatGPTUser: ChatGPTUser | null;
  chatGPTSignOutPath: string;
  locale: Locale;
  workspace: ConsoleWorkspace;
}) {
  const c = consoleCopy[locale];
  const x = x402Copy[locale];
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(() =>
    chatGPTUser
      ? {
          displayName: chatGPTUser.displayName,
          email: chatGPTUser.email,
          walletAddress: null,
          provider: "chatgpt",
        }
      : null,
  );
  const [authChecking, setAuthChecking] = useState(!chatGPTUser);
  const [signingOut, setSigningOut] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(Boolean(chatGPTUser));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [keyLabel, setKeyLabel] = useState("Production");
  const [creatingKey, setCreatingKey] = useState(false);
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [amountUsd, setAmountUsd] =
    useState<(typeof amountOptions)[number]>(25);
  const [payCurrency, setPayCurrency] =
    useState<(typeof currencyOptions)[number]["value"]>("usdttrc20");
  const [creatingPayment, setCreatingPayment] = useState(false);
  const [invoice, setInvoice] = useState<PaymentInvoice | null>(null);
  const [x402BatchId, setX402BatchId] = useState("");
  const [x402Batch, setX402Batch] = useState<X402Batch | null>(null);
  const [loadingX402Batch, setLoadingX402Batch] = useState(false);
  const [x402History, setX402History] =
    useState<X402HistoryResponse | null>(null);
  const [x402HistoryPage, setX402HistoryPage] = useState(1);
  const [x402HistoryView, setX402HistoryView] = useState("all");
  const [loadingX402History, setLoadingX402History] = useState(false);
  const paymentAttemptKey = useRef<string | null>(null);
  const latestInvoicePayment = invoice
    ? dashboard?.payments.find((payment) => payment.id === invoice.id)
    : null;
  const visibleInvoice = invoice
    ? {
        ...invoice,
        status: latestInvoicePayment?.status ?? invoice.status,
        payAmount: latestInvoicePayment?.payAmount ?? invoice.payAmount,
        payAddress: latestInvoicePayment?.payAddress ?? invoice.payAddress,
        invoiceUrl: latestInvoicePayment?.invoiceUrl ?? invoice.invoiceUrl,
      }
    : null;
  const visibleInvoiceId = visibleInvoice?.id ?? null;
  const visibleInvoiceStatus = visibleInvoice?.status ?? null;
  const user = sessionUser;
  const workspacePath =
    workspace === "dashboard" ? "/console" : `/console/${workspace}`;
  const loginPath = `/login?return_to=${encodeURIComponent(workspacePath)}`;

  const refreshDashboard = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const payload = await apiRequest<unknown>(
        "/api/dashboard",
        locale,
        { cache: "no-store" },
      );
      const data = parseDashboardData(payload, locale);
      setDashboard(data);
    } catch (requestError) {
      if (requestError instanceof ApiRequestError && requestError.status === 401) {
        setDashboard(null);
        window.location.replace(loginPath);
        return;
      }
      setError(
        requestError instanceof Error
          ? requestError.message
          : c.dashboardLoadFailed,
      );
    } finally {
      setLoading(false);
    }
  }, [c.dashboardLoadFailed, locale, loginPath, user]);

  const loadX402History = useCallback(
    async (page: number, view: string) => {
      if (!user || workspace !== "x402") return;
      setLoadingX402History(true);
      setError(null);
      try {
        const payload = await apiRequest<unknown>(
          `/api/x402/batches?page=${page}&limit=20&view=${encodeURIComponent(view)}`,
          locale,
          { cache: "no-store" },
        );
        if (!isX402HistoryResponse(payload)) {
          throw new Error(
            locale === "zh"
              ? "x402 批次历史数据格式异常。"
              : "The x402 batch history returned an invalid data shape.",
          );
        }
        setX402History(payload);
      } catch (requestError) {
        if (
          requestError instanceof ApiRequestError &&
          requestError.status === 401
        ) {
          window.location.replace(loginPath);
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : locale === "zh"
              ? "无法加载 x402 批次历史。"
              : "The x402 batch history could not be loaded.",
        );
      } finally {
        setLoadingX402History(false);
      }
    },
    [locale, loginPath, user, workspace],
  );

  useEffect(() => {
    if (chatGPTUser) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setAuthChecking(true);
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload: unknown = await response.json().catch(() => null);
        if (response.status === 401) {
          window.location.replace(loginPath);
          return;
        }
        if (!response.ok) {
          throw new Error(c.sessionCheckFailed(response.status));
        }
        if (!isAuthMeResponse(payload)) {
          throw new Error(c.invalidSession);
        }
        setSessionUser(payload.user);
      } catch (requestError) {
        if (controller.signal.aborted) return;
        setError(
          requestError instanceof Error
            ? requestError.message
            : c.sessionUnknown,
        );
      } finally {
        if (!controller.signal.aborted) setAuthChecking(false);
      }
    }, 0);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [c, chatGPTUser, loginPath]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshDashboard();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshDashboard]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadX402History(x402HistoryPage, x402HistoryView);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadX402History, x402HistoryPage, x402HistoryView]);

  useEffect(() => {
    if (
      !user ||
      !visibleInvoiceId ||
      !visibleInvoiceStatus ||
      [
        "finished",
        "failed",
        "expired",
        "refunded",
        "manual_review",
        "manual_resolved",
      ].includes(
        visibleInvoiceStatus.toLowerCase(),
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshDashboard();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [
    refreshDashboard,
    user,
    visibleInvoiceId,
    visibleInvoiceStatus,
  ]);

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const label = keyLabel.trim();
    if (!label || !user) return;

    setCreatingKey(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<{ key: CreatedKey }>(
        "/api/keys",
        locale,
        {
          method: "POST",
          body: JSON.stringify({ label }),
        },
      );
      setCreatedKey(result.key);
      setKeyLabel("");
      setNotice(c.keyCreated);
      await refreshDashboard();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : c.keyCreateFailed,
      );
    } finally {
      setCreatingKey(false);
    }
  }

  async function revokeKey(key: ApiKeyRecord) {
    if (!user || key.revokedAt) return;
    const confirmed = window.confirm(
      c.revokeConfirm(key.label),
    );
    if (!confirmed) return;

    setRevokingId(key.id);
    setError(null);
    setNotice(null);
    try {
      await apiRequest<{ ok: true }>("/api/keys", locale, {
        method: "DELETE",
        body: JSON.stringify({ id: key.id }),
      });
      setNotice(c.keyRevoked(key.label));
      await refreshDashboard();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : c.keyRevokeFailed,
      );
    } finally {
      setRevokingId(null);
    }
  }

  async function createPayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;

    setCreatingPayment(true);
    setError(null);
    setNotice(null);
    try {
      paymentAttemptKey.current ??=
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `payment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await apiRequest<{ payment: PaymentInvoice }>(
        "/api/payments",
        locale,
        {
          method: "POST",
          headers: {
            "Idempotency-Key": paymentAttemptKey.current,
          },
          body: JSON.stringify({ amountUsd, payCurrency }),
        },
      );
      paymentAttemptKey.current = null;
      setInvoice(result.payment);
      setNotice(c.invoiceCreated);
      await refreshDashboard();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : c.invoiceCreateFailed,
      );
    } finally {
      setCreatingPayment(false);
    }
  }

  async function lookupX402Batch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = x402BatchId.trim();
    if (!/^xb_[A-Za-z0-9_-]{20,80}$/.test(id)) {
      setError(
        locale === "zh"
          ? "请输入有效的 x402 批次编号（xb_…）。"
          : "Enter a valid x402 batch ID (xb_…).",
      );
      return;
    }
    setLoadingX402Batch(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<unknown>(
        `/api/x402/batches/${encodeURIComponent(id)}`,
        locale,
        { cache: "no-store" },
      );
      if (!isRecord(result) || !isX402Batch(result.batch)) {
        throw new Error(
          locale === "zh"
            ? "x402 批次回执数据格式异常。"
            : "The x402 batch receipt returned an invalid data shape.",
        );
      }
      setX402Batch(result.batch);
    } catch (requestError) {
      setX402Batch(null);
      setError(
        requestError instanceof Error
          ? requestError.message
          : locale === "zh"
            ? "无法读取 x402 批次。"
            : "The x402 batch could not be loaded.",
      );
    } finally {
      setLoadingX402Batch(false);
    }
  }

  async function signOut(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (signingOut) return;
    setSigningOut(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/auth/signout", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(c.signoutFailed(response.status));
      }
      if (!isSignoutResponse(payload)) {
        throw new Error(c.invalidSignout);
      }
      window.location.assign(
        user?.provider === "chatgpt" ? chatGPTSignOutPath : "/",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : c.signoutFallback,
      );
      setSigningOut(false);
    }
  }

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(successMessage);
    } catch {
      setError(c.copyFailed);
    }
  }

  const displayName =
    dashboard?.user.displayName ??
    user?.displayName ??
    (authChecking ? c.checkingAccount : c.signedOutUser);
  const email =
    dashboard?.user.email ??
    user?.email ??
    (user?.walletAddress
      ? `${user.walletAddress.slice(0, 8)}…${user.walletAddress.slice(-6)}`
      : "");
  const activeKeys = dashboard?.keys.filter((key) => !key.revokedAt) ?? [];
  const recentCalls = dashboard?.calls.slice(0, 8) ?? [];
  const recentPayments = dashboard?.payments.slice(0, 6) ?? [];
  const usedKeys = activeKeys.filter((key) => key.lastUsedAt).length;
  const unusedKeys = activeKeys.length - usedKeys;
  const recentCreditsUsdMicros = recentPayments.reduce(
    (total, payment) =>
      total + payment.creditedUsdMicros - payment.reversedUsdMicros,
    0,
  );
  const terminalPaymentStatuses = new Set([
    "finished",
    "completed",
    "paid",
    "failed",
    "expired",
    "refunded",
    "manual_resolved",
    "provider_error",
  ]);
  const openPayments = recentPayments.filter(
    (payment) => !terminalPaymentStatuses.has(payment.status.toLowerCase()),
  );
  const paymentsEnabled = dashboard?.capabilities.paymentsEnabled ?? false;
  const commercialClearanceConfirmed =
    dashboard?.capabilities.commercialClearanceConfirmed ?? false;
  const usageDays = recentUsageDays(dashboard?.usage.daily);
  const usagePeak = Math.max(
    1,
    ...usageDays.map((day) => day.prepaidCalls + day.x402Calls),
  );
  const usageTotal = usageDays.reduce(
    (total, day) => total + day.prepaidCalls + day.x402Calls,
    0,
  );
  const x402Runtime = dashboard?.x402.runtime;
  const x402RuntimeDescription = x402Runtime?.available
    ? x.runtimeLive
    : x402Runtime?.enabled === false
      ? x.runtimeDisabled
      : x402Runtime?.configured === false
        ? x.runtimeUnconfigured
        : x.runtimeBlocked;
  const x402HistoryScope =
    x402History?.scope ?? dashboard?.x402.historyScope ?? null;
  const x402HistoryPages = Math.max(
    1,
    Math.ceil((x402History?.total ?? 0) / (x402History?.limit ?? 20)),
  );
  const workspaceMeta = c.workspaces[workspace];
  const setupSteps = [
    {
      label: c.checklistKey,
      complete: activeKeys.length > 0,
      href: "/console/keys",
    },
    {
      label: c.checklistBalance,
      complete: (dashboard?.balanceUsdMicros ?? 0) > 0,
      href: "/console/billing",
    },
    {
      label: c.checklistRequest,
      complete: (dashboard?.usage.totalCalls30d ?? 0) > 0,
      href: "/docs",
    },
  ];
  const consoleNavigation = [
    {
      id: "dashboard" as const,
      href: "/console",
      index: "01",
      label: c.workspaces.dashboard.label,
      description: c.navDescriptions.dashboard,
    },
    {
      id: "keys" as const,
      href: "/console/keys",
      index: "02",
      label: c.workspaces.keys.label,
      description: c.navDescriptions.keys,
    },
    {
      id: "billing" as const,
      href: "/console/billing",
      index: "03",
      label: c.workspaces.billing.label,
      description: c.navDescriptions.billing,
    },
    {
      id: "x402" as const,
      href: "/console/x402",
      index: "04",
      label: c.workspaces.x402.label,
      description: c.navDescriptions.x402,
    },
  ];

  return (
    <div className="console-shell">
      <aside className="console-sidebar">
        <div className="console-sidebar-heading">
          <span>RELAYBASE</span>
          <b>{c.developerWorkspace}</b>
        </div>
        <nav className="console-nav" aria-label={c.workspaceNavigation}>
          {consoleNavigation.map((item) => (
            <a
              className={workspace === item.id ? "is-active" : undefined}
              aria-current={workspace === item.id ? "page" : undefined}
              href={item.href}
              key={item.id}
            >
              <span>{item.index}</span>
              <div>
                <b>{item.label}</b>
                <small>{item.description}</small>
              </div>
            </a>
          ))}
        </nav>
        <div className="console-resource-links">
          <span>{c.resources}</span>
          <a href="/catalog">{c.dataMarket}<i>↗</i></a>
          <a href="/docs">{c.documentation}<i>↗</i></a>
        </div>
        <div className="console-side-account">
          <span className="console-avatar" aria-hidden="true">
            {displayName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <b>{displayName}</b>
            <span>{email || c.syncAfterLogin}</span>
          </div>
          {user ? (
            <a
              href={user.provider === "chatgpt" ? chatGPTSignOutPath : "/"}
              onClick={(event) => void signOut(event)}
              aria-disabled={signingOut}
            >
              {signingOut ? c.signingOut : c.signOut}
            </a>
          ) : (
            <a href={loginPath}>{authChecking ? c.checking : c.signIn}</a>
          )}
        </div>
      </aside>

      <div className="console-workspace">
        <header className="console-workspace-header">
          <div>
            <span className="console-breadcrumb">{workspaceMeta.eyebrow}</span>
            <h1>{workspaceMeta.label}</h1>
            <p>{workspaceMeta.description}</p>
          </div>
          <button
            className="console-refresh"
            type="button"
            onClick={() => {
              void refreshDashboard();
              if (workspace === "x402") {
                void loadX402History(
                  x402HistoryPage,
                  x402HistoryView,
                );
              }
            }}
            disabled={!user || loading || loadingX402History}
          >
            {loading || loadingX402History
              ? c.refreshing
              : c.refreshStatus}
          </button>
        </header>

        {authChecking ? (
          <section className="console-auth-banner" role="status">
            <span aria-hidden="true">···</span>
            <div>
              <b>{c.checkingSessionTitle}</b>
              <p>{c.checkingSessionBody}</p>
            </div>
          </section>
        ) : null}

        <div className="console-announcer" aria-live="polite" aria-atomic="true">
          {error ? (
            <div className="console-alert console-alert-error">
              <span>!</span>
              <p>{error}</p>
              <button
                type="button"
                onClick={() => {
                  void refreshDashboard();
                  if (workspace === "x402") {
                    void loadX402History(
                      x402HistoryPage,
                      x402HistoryView,
                    );
                  }
                }}
              >
                {c.retry}
              </button>
            </div>
          ) : null}
          {notice ? (
            <div className="console-alert console-alert-success">
              <span>✓</span>
              <p>{notice}</p>
              <button
                type="button"
                aria-label={c.closeNotice}
                onClick={() => setNotice(null)}
              >
                ×
              </button>
            </div>
          ) : null}
        </div>

        {workspace === "dashboard" ? (
          <>
            <section
              className="console-metric-grid console-usage-metrics"
              aria-label={c.accountOverview}
            >
              <article className="console-metric console-metric-primary">
                <span>{c.availableBalance}</span>
                <strong className={loading ? "loading-value" : ""}>
                  {formatUsd(dashboard?.balanceUsdMicros)}
                </strong>
                <small>PREPAID BALANCE</small>
              </article>
              <article className="console-metric">
                <span>{x.totalCalls}</span>
                <strong className={loading ? "loading-value" : ""}>
                  {dashboard?.usage.totalCalls30d.toLocaleString() ?? "—"}
                </strong>
                <small>PREPAID + X402</small>
              </article>
              <article className="console-metric">
                <span>{x.prepaidCalls}</span>
                <strong className={loading ? "loading-value" : ""}>
                  {dashboard?.usage.prepaidCalls30d.toLocaleString() ?? "—"}
                </strong>
                <small>API KEY / BALANCE</small>
              </article>
              <article className="console-metric">
                <span>{x.x402Calls}</span>
                <strong className={loading ? "loading-value" : ""}>
                  {dashboard?.usage.x402Calls30d.toLocaleString() ?? "—"}
                </strong>
                <small>WALLET TARGETS</small>
              </article>
              <article className="console-metric">
                <span>{x.prepaidSpend}</span>
                <strong className={loading ? "loading-value" : ""}>
                  {formatUsd(
                    dashboard?.usage.prepaidSpend30dUsdMicros,
                  )}
                </strong>
                <small>PREPAID LEDGER</small>
              </article>
              <article className="console-metric">
                <span>{x.x402Spend}</span>
                <strong className={loading ? "loading-value" : ""}>
                  {formatUsd(
                    dashboard?.usage.x402Settled30dUsdMicros,
                  )}
                </strong>
                <small>BASE USDC · BALANCE $0</small>
              </article>
            </section>

            <section className="console-quick-actions" aria-label={c.quickActions}>
              <div>
                <span>QUICK ACTIONS</span>
                <h2>{c.quickActions}</h2>
              </div>
              <a href="/catalog">
                <b>{c.browseData}</b>
                <small>{c.browseDataBody}</small>
                <i>→</i>
              </a>
              <a href="/console/keys">
                <b>{c.createFirstKey}</b>
                <small>{c.createFirstKeyBody}</small>
                <i>→</i>
              </a>
              <a href="/console/billing">
                <b>{c.addFunds}</b>
                <small>{c.addFundsBody}</small>
                <i>→</i>
              </a>
              <a href="/console/x402">
                <b>{locale === "zh" ? "查询 x402 批次" : "Look up an x402 batch"}</b>
                <small>
                  {locale === "zh"
                    ? "核对钱包结算、Base 交易与整批执行状态。"
                    : "Verify wallet settlement, the Base transaction and whole-batch execution."}
                </small>
                <i>→</i>
              </a>
            </section>

            <section className="console-panel console-usage-chart">
              <div className="panel-heading">
                <div>
                  <span>{x.callsChartEyebrow}</span>
                  <h2>{x.callsChart}</h2>
                  <p>{x.callsChartDescription}</p>
                </div>
                <div
                  className="usage-chart-total"
                  aria-label={`${x.totalCalls}: ${usageTotal.toLocaleString()}`}
                >
                  <span>{x.totalCalls}</span>
                  <strong>{usageTotal.toLocaleString()}</strong>
                </div>
              </div>
              <div className="usage-chart-legend" aria-label={x.callsChart}>
                <span><i className="is-prepaid" />{x.prepaidCalls}</span>
                <span><i className="is-x402" />{x.x402Calls}</span>
              </div>
              {usageTotal > 0 ? (
                <div
                  className="usage-bars-wrap"
                  role="img"
                  aria-label={`${x.totalCalls}: ${usageTotal.toLocaleString()}`}
                >
                  <div className="usage-bars">
                    {usageDays.map((day, index) => {
                      const total = day.prepaidCalls + day.x402Calls;
                      const prepaidHeight =
                        (day.prepaidCalls / usagePeak) * 100;
                      const x402Height = (day.x402Calls / usagePeak) * 100;
                      return (
                        <div
                          className="usage-day"
                          key={day.day}
                          title={`${day.day} · ${x.prepaidCalls}: ${day.prepaidCalls} · ${x.x402Calls}: ${day.x402Calls}`}
                        >
                          <div className="usage-bar-value">
                            {total > 0 ? total.toLocaleString() : ""}
                          </div>
                          <div className="usage-bar-track">
                            <span
                              className="usage-bar-segment is-x402"
                              style={{ height: `${x402Height}%` }}
                            />
                            <span
                              className="usage-bar-segment is-prepaid"
                              style={{ height: `${prepaidHeight}%` }}
                            />
                          </div>
                          <span className="usage-day-label">
                            {index % 5 === 0 || index === usageDays.length - 1
                              ? day.day.slice(5)
                              : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="panel-empty panel-empty-inline">
                  <span>CALL_00</span>
                  <p>{x.chartEmpty}</p>
                </div>
              )}
            </section>

            <div className="console-dashboard-grid">
              <section className="console-panel requests-panel">
                <div className="panel-heading">
                  <div>
                    <span>API ACTIVITY</span>
                    <h2>{c.recentRequests}</h2>
                  </div>
                  <a href="/docs">{c.apiDocs}</a>
                </div>
                <div className="requests-table-wrap">
                  <table className="requests-table">
                    <thead>
                      <tr>
                        <th>{c.time}</th>
                        <th>{c.request}</th>
                        <th>{c.platform}</th>
                        <th>{c.status}</th>
                        <th>{c.latency}</th>
                        <th>{c.cost}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentCalls.map((call) => (
                        <tr key={call.id}>
                          <td>{formatDate(call.createdAt, locale, true)}</td>
                          <td>
                            <span className="request-path">
                              <i>{call.method}</i>
                              <code>{call.path}</code>
                            </span>
                            <small
                              className="request-unit-metrics"
                              title={
                                locale === "zh"
                                  ? "客户请求 · 上游尝试 · 目标数 · 返回条目 · 分页单位"
                                  : "Customer request · upstream attempt · targets · returned items · page units"
                              }
                            >
                              Hc {call.customerRequestCount} · Hu{" "}
                              {call.upstreamAttemptCount} · T {call.targetCount}
                              {" · D "}
                              {call.returnedItemCount ?? "—"} · P{" "}
                              {call.paginationUnitCount}
                            </small>
                          </td>
                          <td>{platformDisplayName(call.platform, call.platform, locale)}</td>
                          <td>
                            <span className={`request-status ${
                              call.statusCode >= 200 && call.statusCode < 300
                                ? "request-ok"
                                : "request-failed"
                            }`}>
                              {call.statusCode}
                            </span>
                          </td>
                          <td>{call.latencyMs} ms</td>
                          <td>{formatUsd(call.refunded ? 0 : call.costUsdMicros, 4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!loading && recentCalls.length === 0 ? (
                    <div className="table-empty">
                      <span>NO REQUESTS YET</span>
                      <p>{c.noRequestsUser}</p>
                      <a href="/docs">{c.quickstart}</a>
                    </div>
                  ) : null}
                </div>
              </section>

              <div className="console-dashboard-side">
                <section className="console-panel console-checklist">
                  <div className="panel-heading">
                    <div>
                      <span>SETUP</span>
                      <h2>{c.gettingStarted}</h2>
                    </div>
                  </div>
                  <ol>
                    {setupSteps.map((step, index) => (
                      <li className={step.complete ? "is-complete" : undefined} key={step.label}>
                        <span>{step.complete ? "✓" : index + 1}</span>
                        <div>
                          <b>{step.label}</b>
                          <a href={step.href}>
                            {step.complete ? c.complete : c.nextStep} →
                          </a>
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>

                <section className="console-panel console-status-panel">
                  <div className="panel-heading">
                    <div>
                      <span>ACCOUNT</span>
                      <h2>{c.accountStatus}</h2>
                    </div>
                  </div>
                  <dl>
                    <div>
                      <dt>{c.apiAccess}</dt>
                      <dd className={activeKeys.length > 0 ? "status-ready" : "status-warning"}>
                        {activeKeys.length > 0 ? c.ready : c.actionRequired}
                      </dd>
                    </div>
                    <div>
                      <dt>{c.catalogAccess}</dt>
                      <dd className={dashboard?.capabilities.catalogReady ? "status-ready" : "status-warning"}>
                        {dashboard?.capabilities.catalogReady ? c.ready : c.unavailable}
                      </dd>
                    </div>
                    <div>
                      <dt>{c.billingChannel}</dt>
                      <dd className={paymentsEnabled ? "status-ready" : "status-warning"}>
                        {paymentsEnabled ? c.enabled : c.unavailable}
                      </dd>
                    </div>
                    <div>
                      <dt>x402</dt>
                      <dd
                        className={
                          dashboard?.x402.runtime.available
                            ? "status-ready"
                            : "status-warning"
                        }
                      >
                        {dashboard?.x402.runtime.available
                          ? x.available
                          : x.notReady}
                      </dd>
                    </div>
                    <div>
                      <dt>{c.successRate}</dt>
                      <dd>{formatRate(dashboard?.stats.successRate)}</dd>
                    </div>
                  </dl>
                </section>
              </div>
            </div>
          </>
        ) : null}

        {workspace === "keys" ? (
          <>
            <section className="console-compact-metrics" aria-label={c.keyStatus}>
              <article><span>{c.activeKeys}</span><strong>{activeKeys.length}</strong></article>
              <article><span>{c.keysUsed}</span><strong>{usedKeys}</strong></article>
              <article><span>{c.keysUnused}</span><strong>{unusedKeys}</strong></article>
              <article>
                <span>{c.accountLimit}</span>
                <strong>
                  {dashboard
                    ? `${dashboard.rateLimits.account.rps} RPS`
                    : "—"}
                </strong>
                <small>
                  {dashboard
                    ? `Burst ${dashboard.rateLimits.account.burst}`
                    : c.requestLimitHint}
                </small>
              </article>
            </section>

            <div className="console-keys-grid">
              <section className="console-panel keys-panel">
                <div className="panel-heading">
                  <div>
                    <span>ACCESS CREDENTIALS</span>
                    <h2>{c.credentialInventory}</h2>
                  </div>
                  <span className="panel-count">{activeKeys.length} {c.active.toUpperCase()}</span>
                </div>
                <form className="key-form" onSubmit={createKey}>
                  <label htmlFor="key-label">{c.newKeyLabel}</label>
                  <div>
                    <input
                      id="key-label"
                      value={keyLabel}
                      onChange={(event) => setKeyLabel(event.target.value)}
                      placeholder={c.keyPlaceholder}
                      maxLength={64}
                      disabled={!user || creatingKey}
                      required
                    />
                    <button
                      className="button button-blue"
                      type="submit"
                      disabled={!user || creatingKey || !keyLabel.trim()}
                    >
                      {creatingKey ? c.creating : c.createKey}
                    </button>
                  </div>
                </form>

                {createdKey ? (
                  <div className="created-key-card">
                    <div>
                      <span>{c.showOnce}</span>
                      <button type="button" aria-label={c.closeNewKey} onClick={() => setCreatedKey(null)}>×</button>
                    </div>
                    <p>{c.saveSecret}</p>
                    <small>
                      {c.requestLimit}: {createdKey.rateLimitRps} RPS ·
                      Burst {createdKey.rateLimitBurst}
                    </small>
                    <div className="secret-value">
                      <code>{createdKey.secret}</code>
                      <button type="button" onClick={() => void copyText(createdKey.secret, c.keyCopied)}>
                        {c.copy}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="key-table-wrap">
                  {loading ? (
                    <div className="panel-loading">{c.loadingKeys}</div>
                  ) : activeKeys.length > 0 ? (
                    <table className="key-table">
                      <thead>
                        <tr>
                          <th>{c.keyName}</th>
                          <th>{c.keyPrefix}</th>
                          <th>{c.requestLimit}</th>
                          <th>{c.created}</th>
                          <th>{c.lastUsed}</th>
                          <th>{c.keyStatus}</th>
                          <th>{c.actions}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeKeys.map((key) => (
                          <tr key={key.id}>
                            <td><b>{key.label}</b></td>
                            <td><code>{key.prefix}••••••••</code></td>
                            <td>
                              <b>{key.rateLimitRps} RPS</b>
                              <small> Burst {key.rateLimitBurst}</small>
                            </td>
                            <td>{formatDate(key.createdAt, locale)}</td>
                            <td>{formatDate(key.lastUsedAt, locale, true)}</td>
                            <td><span className="key-active">{c.active}</span></td>
                            <td>
                              <button
                                className="key-revoke"
                                type="button"
                                disabled={revokingId === key.id}
                                onClick={() => void revokeKey(key)}
                              >
                                {revokingId === key.id ? c.revoking : c.revoke}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="panel-empty">
                      <span>KEY_00</span>
                      <p>{c.noKeys}</p>
                    </div>
                  )}
                </div>
              </section>

              <aside className="console-panel security-panel">
                <div className="panel-heading">
                  <div>
                    <span>BEST PRACTICES</span>
                    <h2>{c.securityPractices}</h2>
                  </div>
                </div>
                <p>
                  {c.credentialHelp} {c.requestLimitHint}
                </p>
                <ul>
                  {c.securityItems.map((item, index) => (
                    <li key={item}><span>{index + 1}</span>{item}</li>
                  ))}
                </ul>
                <a href="/docs">{c.documentation} →</a>
              </aside>
            </div>
          </>
        ) : null}

        {workspace === "billing" ? (
          <>
            <section className="console-compact-metrics billing-metrics" aria-label={c.accountOverview}>
              <article className="is-primary">
                <span>{c.availableBalance}</span>
                <strong>{formatUsd(dashboard?.balanceUsdMicros)}</strong>
              </article>
              <article><span>{c.spend30d}</span><strong>{formatUsd(dashboard?.stats.spend30dUsdMicros)}</strong></article>
              <article><span>{c.recentCredits}</span><strong>{formatUsd(recentCreditsUsdMicros)}</strong></article>
              <article><span>{c.openOrders}</span><strong>{openPayments.length}</strong></article>
            </section>

            <div className="console-billing-grid">
              <section className="console-panel topup-panel">
                <div className="panel-heading">
                  <div>
                    <span>ADD FUNDS</span>
                    <h2>{c.topupTitle}</h2>
                  </div>
                  <span className="pay-badge">STABLECOIN</span>
                </div>
                <form onSubmit={createPayment}>
                  <fieldset disabled={!user || loading || creatingPayment || !paymentsEnabled}>
                    <legend>{c.topupAmount}</legend>
                    <div className="amount-options">
                      {amountOptions.map((amount) => (
                        <label key={amount}>
                          <input
                            type="radio"
                            name="amount"
                            value={amount}
                            checked={amountUsd === amount}
                            onChange={() => {
                              paymentAttemptKey.current = null;
                              setAmountUsd(amount);
                            }}
                          />
                          <span>${amount}</span>
                        </label>
                      ))}
                    </div>
                    <label className="currency-select">
                      <span>{c.assetNetwork}</span>
                      <select
                        value={payCurrency}
                        onChange={(event) => {
                          paymentAttemptKey.current = null;
                          setPayCurrency(event.target.value as typeof payCurrency);
                        }}
                      >
                        {currencyOptions.map((currency) => (
                          <option value={currency.value} key={currency.value}>{currency.label}</option>
                        ))}
                      </select>
                    </label>
                  </fieldset>
                  <button
                    className="button button-lime topup-submit"
                    type="submit"
                    disabled={!user || loading || creatingPayment || !paymentsEnabled}
                  >
                    {creatingPayment ? c.creatingInvoice : c.topup(amountUsd)}
                    <span aria-hidden="true">↗</span>
                  </button>
                </form>
                <p className="topup-warning">
                  {user && !loading && !paymentsEnabled
                    ? !commercialClearanceConfirmed
                      ? c.clearanceClosed
                      : c.topupUnavailable
                    : c.topupSafety}
                </p>
              </section>

              <aside className="console-panel billing-help">
                <div className="panel-heading">
                  <div><span>PAYMENT FLOW</span><h2>{c.billingHelpTitle}</h2></div>
                </div>
                <p>{c.billingHelp}</p>
                <ol>
                  <li><span>1</span>{c.topupAmount}</li>
                  <li><span>2</span>{c.assetNetwork}</li>
                  <li><span>3</span>{c.balanceAutoUpdate}</li>
                </ol>
              </aside>
            </div>

            {visibleInvoice ? (
              <section className="invoice-panel">
                <div className="invoice-title">
                  <div><span>PAYMENT INVOICE</span><h2>{c.invoiceTitle}</h2></div>
                  <button type="button" aria-label={c.closeInvoice} onClick={() => setInvoice(null)}>×</button>
                </div>
                <div className="invoice-grid">
                  <div>
                    <span>{c.amountDue}</span>
                    <strong>{visibleInvoice.payAmount ?? "—"}</strong>
                    <small>{currencyLabel(visibleInvoice.payCurrency)}</small>
                  </div>
                  <div className="invoice-address">
                    <span>{c.receivingAddress}</span>
                    <code>{visibleInvoice.payAddress ?? c.addressPending}</code>
                    {visibleInvoice.payAddress ? (
                      <button type="button" onClick={() => void copyText(visibleInvoice.payAddress!, c.addressCopied)}>
                        {c.copyAddress}
                      </button>
                    ) : null}
                  </div>
                  <div>
                    <span>{c.currentStatus}</span>
                    <strong className="invoice-status">{paymentStatus(visibleInvoice.status, locale)}</strong>
                    <small>{c.balanceAutoUpdate}</small>
                  </div>
                </div>
                {visibleInvoice.invoiceUrl ? (
                  <a className="button button-dark" href={visibleInvoice.invoiceUrl} target="_blank" rel="noreferrer">
                    {c.openInvoice}
                  </a>
                ) : null}
              </section>
            ) : null}

            <section className="console-panel payment-history">
              <div className="panel-heading">
                <div><span>ACCOUNT LEDGER</span><h2>{c.paymentActivity}</h2></div>
                <button type="button" onClick={() => void refreshDashboard()} disabled={!user || loading}>
                  {loading ? c.refreshing : c.refreshStatus}
                </button>
              </div>
              {recentPayments.length > 0 ? (
                <div className="payment-list">
                  {recentPayments.map((payment) => (
                    <article key={payment.id}>
                      <span className={`payment-dot payment-${paymentStatusClass(payment.status)}`} aria-hidden="true" />
                      <div>
                        <b>{formatUsd(payment.amountUsdMicros)}</b>
                        <span>
                          {c.credited} {formatUsd(payment.creditedUsdMicros)}
                          {payment.reversedUsdMicros > 0 ? ` · ${c.reversed} ${formatUsd(payment.reversedUsdMicros)}` : ""}
                          {" · "}{currencyLabel(payment.payCurrency)}
                          {paymentReviewReason(payment.reviewReason, locale)
                            ? ` · ${paymentReviewReason(payment.reviewReason, locale)}`
                            : ""}
                        </span>
                      </div>
                      <code>{payment.id}</code>
                      <span>{formatDate(payment.createdAt, locale, true)}</span>
                      <strong>{paymentStatus(payment.status, locale)}</strong>
                      {payment.payAddress && !terminalPaymentStatuses.has(payment.status.toLowerCase()) ? (
                        <button
                          type="button"
                          onClick={() => setInvoice({
                            id: payment.id,
                            status: payment.status,
                            payAddress: payment.payAddress,
                            payAmount: payment.payAmount,
                            payCurrency: payment.payCurrency,
                            invoiceUrl: payment.invoiceUrl,
                          })}
                        >
                          {c.continuePayment}
                        </button>
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <div className="panel-empty panel-empty-inline">
                  <span>PAY_00</span><p>{c.noTopups}</p>
                </div>
              )}
            </section>
          </>
        ) : null}

        {workspace === "x402" ? (
          <>
            <section
              className="console-compact-metrics console-x402-metrics"
              aria-label={x.readiness}
            >
              <article
                className={
                  x402Runtime?.available
                    ? "is-primary is-ready"
                    : "is-primary is-not-ready"
                }
              >
                <span>{x.readiness}</span>
                <strong>
                  {x402Runtime?.available ? x.available : x.notReady}
                </strong>
                <small>{x402RuntimeDescription}</small>
              </article>
              <article>
                <span>{x.targetCalls}</span>
                <strong>
                  {dashboard?.usage.x402Calls30d.toLocaleString() ?? "—"}
                </strong>
                <small>{x.quantity}</small>
              </article>
              <article>
                <span>{x.settledAmount}</span>
                <strong>
                  {formatUsd(
                    dashboard?.usage.x402Settled30dUsdMicros,
                  )}
                </strong>
                <small>BASE USDC · {x.balanceBoundary}</small>
              </article>
              <article>
                <span>{x.batchStatus}</span>
                <strong>
                  {dashboard
                    ? `${dashboard.usage.x402SettledBatches30d} / ${dashboard.usage.x402PendingBatches}`
                    : "—"}
                </strong>
                <small>{x.batchStatusSub}</small>
              </article>
            </section>

            <section className="console-x402-boundary" role="note">
              <div>
                <span
                  className={
                    x402Runtime?.available
                      ? "x402-runtime-dot is-ready"
                      : "x402-runtime-dot is-not-ready"
                  }
                />
                <div>
                  <strong>
                    {x402Runtime?.available ? x.available : x.notReady}
                  </strong>
                  <p>{x402RuntimeDescription}</p>
                </div>
              </div>
              <p>{x.paymentBoundary}</p>
              <p>{x.balanceBoundary}</p>
              <a href="/docs#x402">
                {locale === "zh" ? "查看接入文档 →" : "Open integration docs →"}
              </a>
            </section>

            <section className="console-panel console-x402-history">
              <div className="panel-heading">
                <div>
                  <span>{x.historyEyebrow}</span>
                  <h2>{x.history}</h2>
                  <p>{x.historyDescription}</p>
                </div>
                <div className="x402-scope">
                  <span>
                    {x402HistoryScope?.kind === "signed_in_wallet"
                      ? x.walletScope
                      : x.noWalletScope}
                  </span>
                  <code>
                    {compactValue(
                      x402HistoryScope?.walletAddress ?? null,
                      8,
                      6,
                    )}
                  </code>
                </div>
              </div>

              <div className="x402-history-toolbar">
                <label>
                  <span>{x.filter}</span>
                  <select
                    value={x402HistoryView}
                    onChange={(event) => {
                      setX402HistoryPage(1);
                      setX402HistoryView(event.target.value);
                    }}
                  >
                    <option value="all">{x.filterAll}</option>
                    <option value="settled">{x.filterSettled}</option>
                    <option value="pending">{x.filterPending}</option>
                    <option value="failed">{x.filterFailed}</option>
                    <option value="succeeded">{x.filterSucceeded}</option>
                  </select>
                </label>
                <form onSubmit={lookupX402Batch}>
                  <label htmlFor="x402-batch-id">{x.lookupLabel}</label>
                  <div>
                    <input
                      id="x402-batch-id"
                      value={x402BatchId}
                      onChange={(event) => setX402BatchId(event.target.value)}
                      placeholder={x.lookupPlaceholder}
                      maxLength={83}
                      autoComplete="off"
                      required
                    />
                    <button
                      type="submit"
                      disabled={loadingX402Batch}
                    >
                      {loadingX402Batch
                        ? x.lookupLoading
                        : x.lookupButton}
                    </button>
                  </div>
                </form>
              </div>

              {loadingX402History && !x402History ? (
                <div className="panel-loading">{x.loadingHistory}</div>
              ) : x402HistoryScope?.kind !== "signed_in_wallet" ? (
                <div className="table-empty">
                  <span>WALLET_SCOPE_00</span>
                  <p>{x.noWalletHistory}</p>
                  <a href="/docs#x402">{c.quickstart}</a>
                </div>
              ) : x402History?.batches.length ? (
                <>
                  <div className="x402-table-wrap">
                    <table className="x402-table">
                      <thead>
                        <tr>
                          <th>{x.batchId} / {x.product}</th>
                          <th className="is-number">{x.quantity}</th>
                          <th className="is-number">{x.amount}</th>
                          <th>{x.wallet}</th>
                          <th>{x.payment}</th>
                          <th>{x.execution}</th>
                          <th>{x.transaction}</th>
                          <th>{x.updated}</th>
                          <th aria-label={x.actions} />
                        </tr>
                      </thead>
                      <tbody>
                        {x402History.batches.map((batch) => (
                          <tr
                            className={
                              x402Batch?.id === batch.id
                                ? "is-selected"
                                : undefined
                            }
                            key={batch.id}
                          >
                            <td>
                              <button
                                className="x402-batch-link"
                                type="button"
                                onClick={() => setX402Batch(batch)}
                              >
                                <code>{compactValue(batch.id, 10, 6)}</code>
                                <span>{batch.endpoint}</span>
                              </button>
                            </td>
                            <td className="is-number">
                              {batch.verifiedQuantity.toLocaleString()}
                            </td>
                            <td className="is-number">
                              <strong>
                                {formatUsd(batch.amountUsdcAtomic, 6)}
                              </strong>
                              <span>USDC</span>
                            </td>
                            <td>
                              <code title={batch.payer ?? undefined}>
                                {compactValue(batch.payer)}
                              </code>
                            </td>
                            <td>
                              <span
                                className={`x402-status is-${batch.paymentStatus}`}
                              >
                                {x402PaymentLabel(
                                  batch.paymentStatus,
                                  locale,
                                )}
                              </span>
                            </td>
                            <td>
                              <span
                                className={`x402-status ${x402ExecutionClass(batch.status)}`}
                              >
                                {x402ExecutionLabel(batch.status, locale)}
                              </span>
                            </td>
                            <td>
                              {batch.transaction ? (
                                <code title={batch.transaction}>
                                  {compactValue(batch.transaction)}
                                </code>
                              ) : (
                                <span className="x402-no-value">
                                  {x.noTransaction}
                                </span>
                              )}
                            </td>
                            <td>{formatDate(batch.updatedAt, locale, true)}</td>
                            <td>
                              <button
                                className="x402-row-action"
                                type="button"
                                onClick={() => setX402Batch(batch)}
                              >
                                {x.view}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="x402-pagination">
                    <span>
                      {x.page(x402History.page, x402HistoryPages)}
                      {" · "}
                      {x402History.total.toLocaleString()} {x.records}
                    </span>
                    <div>
                      <button
                        type="button"
                        disabled={x402History.page <= 1}
                        onClick={() =>
                          setX402HistoryPage((page) => Math.max(1, page - 1))
                        }
                      >
                        ← {x.previous}
                      </button>
                      <button
                        type="button"
                        disabled={!x402History.hasNext}
                        onClick={() =>
                          setX402HistoryPage((page) => page + 1)
                        }
                      >
                        {x.next} →
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="table-empty">
                  <span>X402_00</span>
                  <p>{x.noHistory}</p>
                  <a href="/catalog">{c.dataMarket} →</a>
                </div>
              )}
            </section>

            <section className="console-panel console-x402-detail">
              <div className="panel-heading">
                <div>
                  <span>{x.detailEyebrow}</span>
                  <h2>{x.detail}</h2>
                </div>
                {x402Batch ? (
                  <button
                    type="button"
                    onClick={() =>
                      void copyText(x402Batch.id, x.batchCopied)
                    }
                  >
                    {x.copyBatch}
                  </button>
                ) : null}
              </div>
              {x402Batch ? (
                <>
                  <div className="x402-detail-summary">
                    <div className="x402-detail-title">
                      <code>{x402Batch.id}</code>
                      <div>
                        <span
                          className={`x402-status is-${x402Batch.paymentStatus}`}
                        >
                          {x402PaymentLabel(
                            x402Batch.paymentStatus,
                            locale,
                          )}
                        </span>
                        <span
                          className={`x402-status ${x402ExecutionClass(x402Batch.status)}`}
                        >
                          {x402ExecutionLabel(x402Batch.status, locale)}
                        </span>
                      </div>
                    </div>
                    <dl>
                      <div>
                        <dt>{x.product}</dt>
                        <dd><code>{x402Batch.endpoint}</code></dd>
                      </div>
                      <div>
                        <dt>{locale === "zh" ? "执行方式" : "Execution"}</dt>
                        <dd>{x402Batch.executionMode}</dd>
                      </div>
                      <div>
                        <dt>{x.quantity}</dt>
                        <dd>{x402Batch.verifiedQuantity.toLocaleString()}</dd>
                      </div>
                      <div>
                        <dt>{locale === "zh" ? "上游请求" : "Upstream requests"}</dt>
                        <dd>
                          {x402Batch.actualUpstreamAttempts.toLocaleString()}
                          {" / "}
                          {x402Batch.plannedUpstreamRequests.toLocaleString()}
                        </dd>
                      </div>
                      <div>
                        <dt>{locale === "zh" ? "返回条目" : "Returned items"}</dt>
                        <dd>
                          {x402Batch.returnedItemCount?.toLocaleString() ??
                            (locale === "zh"
                              ? "响应结构待确认"
                              : "Response shape unverified")}
                        </dd>
                      </div>
                      <div>
                        <dt>{x.unitPrice}</dt>
                        <dd>{formatUsd(x402Batch.unitPriceUsdMicros, 6)}</dd>
                      </div>
                      <div>
                        <dt>{x.amount}</dt>
                        <dd>{formatUsd(x402Batch.amountUsdcAtomic, 6)} USDC</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="x402-evidence-grid">
                    <article>
                      <div className="x402-evidence-heading">
                        <span>01</span>
                        <h3>{x.settlementEvidence}</h3>
                      </div>
                      <dl>
                        <div>
                          <dt>{x.wallet}</dt>
                          <dd className="x402-full-value">
                            <code>{x402Batch.payer ?? x.notRecorded}</code>
                            {x402Batch.payer &&
                            /^0x[a-fA-F0-9]{40}$/.test(x402Batch.payer) ? (
                              <button
                                type="button"
                                onClick={() =>
                                  void copyText(
                                    x402Batch.payer ?? "",
                                    x.walletCopied,
                                  )
                                }
                              >
                                {x.copyWallet}
                              </button>
                            ) : null}
                          </dd>
                        </div>
                        <div>
                          <dt>{x.transaction}</dt>
                          <dd className="x402-full-value">
                            <code>
                              {x402Batch.transaction ?? x.notRecorded}
                            </code>
                            {x402Batch.transaction ? (
                              <div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void copyText(
                                      x402Batch.transaction ?? "",
                                      x.transactionCopied,
                                    )
                                  }
                                >
                                  {x.copyTransaction}
                                </button>
                                <a
                                  href={`https://basescan.org/tx/${x402Batch.transaction}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {x.viewTransaction}
                                </a>
                              </div>
                            ) : null}
                          </dd>
                        </div>
                        <div>
                          <dt>{x.settled}</dt>
                          <dd>
                            {x402Batch.settledAt
                              ? formatDate(
                                  x402Batch.settledAt,
                                  locale,
                                  true,
                                )
                              : x.notRecorded}
                          </dd>
                        </div>
                      </dl>
                      <p
                        className={
                          x402Batch.transaction
                            ? "x402-evidence-note is-confirmed"
                            : "x402-evidence-note is-pending"
                        }
                      >
                        {x402Batch.transaction
                          ? x.receiptConfirmed
                          : x.receiptMissing}
                      </p>
                    </article>

                    <article>
                      <div className="x402-evidence-heading">
                        <span>02</span>
                        <h3>{x.executionEvidence}</h3>
                      </div>
                      <dl>
                        <div>
                          <dt>{x.quoted}</dt>
                          <dd>{formatDate(x402Batch.quotedAt, locale, true)}</dd>
                        </div>
                        <div>
                          <dt>{x.started}</dt>
                          <dd>
                            {x402Batch.executionStartedAt
                              ? formatDate(
                                  x402Batch.executionStartedAt,
                                  locale,
                                  true,
                                )
                              : x.notRecorded}
                          </dd>
                        </div>
                        <div>
                          <dt>{x.completed}</dt>
                          <dd>
                            {x402Batch.completedAt
                              ? formatDate(
                                  x402Batch.completedAt,
                                  locale,
                                  true,
                                )
                              : x.notRecorded}
                          </dd>
                        </div>
                        <div>
                          <dt>{x.failureCode}</dt>
                          <dd>
                            <code>
                              {x402Batch.failureCode ?? x.notRecorded}
                            </code>
                          </dd>
                        </div>
                      </dl>
                      <p className="x402-evidence-note">
                        {x.runtimeClarification}
                      </p>
                    </article>
                  </div>
                </>
              ) : (
                <div className="panel-empty">
                  <span>RECEIPT_00</span>
                  <p>{x.detailEmpty}</p>
                </div>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
