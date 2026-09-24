import "server-only";

// SEC-HTTP-09: shared fixed-window rate limiter for surfaces that have no
// authenticated user id to key on (sign-in Server Actions, unauthenticated
// report endpoints).
//
// Two modes:
//
// - `distributed: true` — the shared counter `bump_extension_rate_limit`
//   (supabase/migrations/20261126020000_extension_rate_limits.sql), which is
//   atomic and holds across server instances. That RPC keys on a `uuid`
//   column, so an arbitrary string key (an IP, an email) is mapped onto a
//   deterministic UUID via SHA-256 (`keyToUuid`). The bucket name keeps the
//   namespaces apart; no schema change is needed. On RPC failure the call
//   falls back to the in-process window below (never fails fully open).
//
// - `distributed: false` — in-process window only. Per instance, so on N
//   instances a client gets up to N× the limit. Used for high-volume,
//   low-value endpoints (CSP / client-error reports) where one DB write per
//   request would cost more than the abuse it prevents.
//
// Keys should never contain secrets; emails are hashed before they reach
// the database (the UUID is a SHA-256 prefix) and never logged.

import { createHash } from "node:crypto";
import { headers } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";

export type RateLimitRule = {
  /** Namespace, e.g. "auth_magic_link_ip". Also the RPC's `p_bucket`. */
  bucket: string;
  /** Max calls allowed per window. */
  limit: number;
  /** Fixed window length, aligned to epoch multiples. */
  windowSeconds: number;
  /** Use the cross-instance DB counter (with in-process fallback). */
  distributed?: boolean;
};

const MAX_TRACKED_KEYS = 10_000;
const localWindows = new Map<string, { windowStart: number; count: number }>();

/** In-process fixed window. Returns true when the call is within the limit. */
export function bumpLocalWindow(rule: RateLimitRule, key: string, now = Date.now()): boolean {
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const mapKey = `${rule.bucket}\u0000${key}`;
  const entry = localWindows.get(mapKey);
  if (!entry || entry.windowStart !== windowStart) {
    if (!entry && localWindows.size >= MAX_TRACKED_KEYS) {
      // Evict the oldest insertion; bounded memory under key-spraying.
      const oldest = localWindows.keys().next().value;
      if (oldest !== undefined) localWindows.delete(oldest);
    }
    localWindows.set(mapKey, { windowStart, count: 1 });
    return 1 <= rule.limit;
  }
  entry.count += 1;
  return entry.count <= rule.limit;
}

export function resetRateLimitsForTests(): void {
  localWindows.clear();
}

/** Deterministic UUID-shaped digest of `bucket:key` for the uuid-keyed RPC. */
export function keyToUuid(bucket: string, key: string): string {
  const hex = createHash("sha256").update(`${bucket}:${key}`).digest("hex");
  // Shape as a v4-style UUID (version/variant nibbles fixed) so Postgres
  // accepts it; uniqueness comes from the 122 remaining hash bits.
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

/**
 * Records one call against `rule` for `key` and reports whether it is
 * allowed. Never throws.
 */
export async function checkRateLimit(rule: RateLimitRule, key: string): Promise<boolean> {
  if (rule.distributed) {
    try {
      const { data, error } = await createAdminClient().rpc("bump_extension_rate_limit", {
        p_user_id: keyToUuid(rule.bucket, key),
        p_bucket: rule.bucket,
        p_limit: rule.limit,
        p_window_seconds: rule.windowSeconds,
      });
      if (!error && typeof data === "boolean") return data;
      logger.warn("rate limit RPC failed; using in-process limit", {
        bucket: rule.bucket,
        error,
      });
    } catch (error) {
      logger.warn("rate limit RPC threw; using in-process limit", {
        bucket: rule.bucket,
        error,
      });
    }
  }
  return bumpLocalWindow(rule, key);
}

/**
 * Best-effort client IP: the first hop of `x-forwarded-for` (set by the
 * platform edge — on Vercel it is overwritten, not appended, so the first
 * entry is the real client), then `x-real-ip`, else "unknown". "unknown"
 * shares one bucket, which only matters when there is no proxy in front
 * (local dev).
 */
export function clientIpFromHeaders(requestHeaders: Pick<Headers, "get">): string {
  const forwarded = requestHeaders.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  if (first) return first.slice(0, 64);
  const real = requestHeaders.get("x-real-ip")?.trim();
  if (real) return real.slice(0, 64);
  return "unknown";
}

/**
 * Client IP for a Server Action (reads `next/headers`). Returns "unknown"
 * outside a request scope instead of throwing.
 */
export async function clientIpFromRequest(): Promise<string> {
  try {
    return clientIpFromHeaders(await headers());
  } catch {
    return "unknown";
  }
}
