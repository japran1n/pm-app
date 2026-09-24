import "server-only";

// Per-user limit on outbound link-preview fetches (cache misses only), so a
// chat channel cannot be used to hammer an arbitrary external host.
//
// Primary: the shared fixed-window counter `bump_extension_rate_limit`
// (see supabase/migrations/20261126020000_extension_rate_limits.sql), which is
// generic over its bucket name and holds across server instances.
// Fallback when that RPC is unavailable: an in-process fixed window. It is
// per instance, so on N instances a user gets up to N× the limit — acceptable
// for a degraded path, and still bounded.

import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/observability/logger";

const BUCKET = "chat_link_preview";
export const LINK_PREVIEW_LIMIT = 30;
export const LINK_PREVIEW_WINDOW_SECONDS = 60;

const MAX_TRACKED_USERS = 5000;
const localWindows = new Map<string, { windowStart: number; count: number }>();

export function bumpLocalWindow(userId: string, now = Date.now()): boolean {
  const windowMs = LINK_PREVIEW_WINDOW_SECONDS * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const entry = localWindows.get(userId);
  if (!entry || entry.windowStart !== windowStart) {
    if (localWindows.size >= MAX_TRACKED_USERS && !entry) {
      const oldest = localWindows.keys().next().value;
      if (oldest !== undefined) localWindows.delete(oldest);
    }
    localWindows.set(userId, { windowStart, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= LINK_PREVIEW_LIMIT;
}

export function resetLinkPreviewRateLimitForTests(): void {
  localWindows.clear();
}

export async function allowLinkPreviewFetch(userId: string): Promise<boolean> {
  try {
    const { data, error } = await createAdminClient().rpc("bump_extension_rate_limit", {
      p_user_id: userId,
      p_bucket: BUCKET,
      p_limit: LINK_PREVIEW_LIMIT,
      p_window_seconds: LINK_PREVIEW_WINDOW_SECONDS,
    });
    if (!error && typeof data === "boolean") return data;
    logger.warn("link-preview rate limit RPC failed; using in-process limit", { error });
  } catch (error) {
    logger.warn("link-preview rate limit RPC threw; using in-process limit", { error });
  }
  return bumpLocalWindow(userId);
}
