// Shared bearer-auth + CORS + rate-limit preamble for the three QA
// extension Route Handlers (audit ARCH-008; previously triplicated
// verbatim in app/api/extension/{tasks,context,attachments}/route.ts —
// the context route's own comment said "if a third extension route is
// ever added, that's the point to factor this out for real"; the third
// route exists, so here it is).
//
// Behavior is preserved EXACTLY from the three copies:
//  - Identity is resolved ONLY from `Authorization: Bearer <token>` via
//    `auth.getUser(token)` against a fresh publishable-key client (see
//    the tasks route's F292 header comment for the full rationale — the
//    cookie-based lib/supabase/server.ts client reads cookies, not a
//    bearer header, and would never see this token).
//  - Missing/malformed/expired/wrong-project tokens all get a uniform
//    401 (Supabase does not distinguish these cases; neither do we).
//  - CORS allows exactly one Origin, `chrome-extension://<EXTENSION_ID>`.
//    A request from any other Origin (or with none, e.g. this repo's own
//    vitest integration tests invoking the handlers directly) proceeds
//    with NO CORS headers attached — CORS is a browser-enforced
//    restriction, not the security boundary; auth/membership are.
//
// New here (audit ARCH-007): a per-user, per-route fixed-window rate
// limit enforced via the SECURITY DEFINER RPC
// `public.bump_extension_rate_limit` (migration
// 20261126020000_extension_rate_limits.sql), called on the admin client
// after auth succeeds. Over-limit calls get 429 + Retry-After with the
// same CORS headers. The check FAILS OPEN: if the RPC itself errors
// (including "function does not exist" before the migration is applied),
// the request is allowed and a logger.error is emitted — a DB hiccup
// must not take the extension down.

import { NextResponse, type NextRequest } from "next/server";
import {
  createClient as createSupabaseClient,
  type User,
} from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/observability/logger";

// Audit NX-003: previously an unset EXTENSION_ID silently disabled all
// CORS headers on every extension route (every real extension request
// then fails opaquely in the browser). Loud, once, at module scope.
if (!process.env.EXTENSION_ID) {
  logger.error(
    "EXTENSION_ID is not set: extension API routes will emit NO CORS headers, so every cross-origin request from the browser extension will be blocked by the browser. Set EXTENSION_ID in .env.",
  );
}

export interface ExtensionRateLimit {
  /** Counter bucket name, unique per route (e.g. "tasks_post"). */
  bucket: string;
  /** Max allowed calls per window. */
  limit: number;
  /** Fixed window length in seconds. */
  windowSeconds: number;
}

export interface ExtensionAuthContext {
  /** The verified caller (from the bearer JWT, never the body). */
  user: User;
  /** CORS headers for THIS request's Origin — attach to every response. */
  headers: Record<string, string>;
  /** RLS-bypassing admin client (already created for the rate limit). */
  admin: ReturnType<typeof createAdminClient>;
}

export function corsHeaders(
  origin: string | null,
  methods: string,
): Record<string, string> {
  const extensionId = serverEnv().EXTENSION_ID;
  const allowedOrigin = extensionId
    ? `chrome-extension://${extensionId}`
    : null;

  if (!allowedOrigin || origin !== allowedOrigin) {
    return {};
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    Vary: "Origin",
  };
}

/** Build the shared OPTIONS preflight handler for an extension route. */
export function extensionOptions(methods: string) {
  return async function OPTIONS(request: NextRequest) {
    const origin = request.headers.get("origin");
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin, methods),
    });
  };
}

/**
 * Wrap an extension route handler with the shared bearer-auth + CORS +
 * rate-limit preamble. The wrapped handler only runs for an
 * authenticated, within-limit caller and receives `{ user, headers,
 * admin }`; all early-exit responses (401/429) carry the same CORS
 * headers the handler's own responses do.
 */
export function withExtensionAuth(
  options: { methods: string; rateLimit: ExtensionRateLimit },
  handler: (
    request: NextRequest,
    context: ExtensionAuthContext,
  ) => Promise<NextResponse>,
) {
  return async function wrapped(request: NextRequest): Promise<NextResponse> {
    const origin = request.headers.get("origin");
    const headers = corsHeaders(origin, options.methods);

    const authHeader = request.headers.get("authorization") ?? "";
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader);
    const token = bearerMatch?.[1]?.trim();

    if (!token) {
      return NextResponse.json(
        { error: "Missing or invalid Authorization header." },
        { status: 401, headers },
      );
    }

    // Fresh publishable-key client; auth.getUser(token) validates the
    // JWT's signature and expiry against Supabase Auth itself.
    const env = serverEnv();
    const authClient = createSupabaseClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(token);

    if (authError || !user) {
      // Missing, malformed, expired, and mismatched-project tokens all
      // land here — auth.getUser() does not distinguish them.
      return NextResponse.json(
        { error: "Invalid or expired session. Reconnect the extension." },
        { status: 401, headers },
      );
    }

    const admin = createAdminClient();

    // ARCH-007: per-user fixed-window rate limit. Fail OPEN on RPC error.
    const { bucket, limit, windowSeconds } = options.rateLimit;
    const { data: allowed, error: rateLimitError } = await admin.rpc(
      "bump_extension_rate_limit",
      {
        p_user_id: user.id,
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      },
    );

    if (rateLimitError) {
      logger.error(
        "extension-auth: rate limit RPC failed; allowing request (fail-open)",
        { bucket, error: rateLimitError },
      );
    } else if (allowed === false) {
      // Windows are aligned to epoch multiples of windowSeconds (see the
      // migration), so seconds-until-next-window is computable here.
      const nowSeconds = Math.floor(Date.now() / 1000);
      const retryAfterSeconds = windowSeconds - (nowSeconds % windowSeconds);
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: 429,
          headers: { ...headers, "Retry-After": String(retryAfterSeconds) },
        },
      );
    }

    return handler(request, { user, headers, admin });
  };
}
