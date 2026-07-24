/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import {
  handlePlatformRequest,
  type PlatformEnv,
  type WorkerExecutionContext,
} from "./platform";

interface Env extends PlatformEnv {
  ASSETS: Fetcher;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext extends WorkerExecutionContext {
  passThroughOnException(): void;
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "content-security-policy",
    "base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
  );
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const runtimeEnv = env ?? ({} as Env);
    const runtimeContext =
      ctx ??
      ({
        waitUntil() {},
        passThroughOnException() {},
      } as ExecutionContext);
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return withSecurityHeaders(
        await handleImageOptimization(
          request,
          {
            fetchAsset: (path) =>
              runtimeEnv.ASSETS.fetch(
                new Request(new URL(path, request.url)),
              ),
            transformImage: async (body, { width, format, quality }) => {
              const result = await runtimeEnv.IMAGES.input(body)
                .transform(width > 0 ? { width } : {})
                .output({ format, quality });
              return result.response();
            },
          },
          allowedWidths,
        ),
      );
    }

    const platformResponse = await handlePlatformRequest(
      request,
      runtimeEnv,
      runtimeContext,
    );
    if (platformResponse) return withSecurityHeaders(platformResponse);

    return withSecurityHeaders(
      await handler.fetch(request, runtimeEnv, runtimeContext),
    );
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const reconciliationSecret = env.RECONCILIATION_SECRET;
    if (
      !reconciliationSecret ||
      reconciliationSecret.length < 32 ||
      reconciliationSecret !== reconciliationSecret.trim()
    ) {
      throw new Error(
        "RECONCILIATION_SECRET is required for scheduled reconciliation",
      );
    }
    const response = await handlePlatformRequest(
      new Request("https://relaybase.internal/api/admin/reconcile", {
        method: "POST",
        headers: {
          authorization: `Bearer ${reconciliationSecret}`,
        },
      }),
      env,
      ctx,
    );
    if (!response || !response.ok) {
      throw new Error(
        `Scheduled reconciliation failed with HTTP ${response?.status ?? 500}`,
      );
    }
  },
};

export default worker;
