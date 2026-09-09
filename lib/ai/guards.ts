// F020: guards for the docs assistant route — per-user rate limiting and
// per-thread token ceiling. Both are pure, dependency-free checks the route
// calls before doing any model work; neither one talks to the network,
// Supabase, or the model.
//
// In-memory rate limit: acceptable for a single-instance deployment; would
// need Redis (or another shared store) on multi-instance, since each
// instance would otherwise keep its own independent counter and the
// effective limit would be `20 * instanceCount` requests/minute rather than
// 20 per user.

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;

/** Per-thread cumulative token ceiling (sum of usage.in + usage.out). */
export const THREAD_TOKEN_CEILING = 200_000;

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export type TokenCeilingResult =
  | { allowed: true }
  | { allowed: false };

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// Module-level in-memory store — see the file header note on why this is
// acceptable for a single-instance deployment only.
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * 20 requests per 60-second rolling window per user. The window resets
 * (rather than sliding) once `resetAt` passes — simple and sufficient for
 * a single-instance guard.
 */
export function checkRateLimit(userId: string, now: number = Date.now()): RateLimitResult {
  const entry = rateLimitStore.get(userId);

  if (!entry || now >= entry.resetAt) {
    rateLimitStore.set(userId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count += 1;
  return { allowed: true };
}

/**
 * Test-only: clears the in-memory rate limit store so tests don't leak
 * state across cases/files.
 */
export function __resetRateLimitStoreForTests() {
  rateLimitStore.clear();
}

/**
 * A thread's cumulative token usage (sum of `usage.in` + `usage.out` across
 * every turn so far) must stay under THREAD_TOKEN_CEILING. `threadUsage` is
 * the total BEFORE the current request; a thread already at or over the
 * ceiling is blocked.
 */
export function checkTokenCeiling(threadUsage: number): TokenCeilingResult {
  if (threadUsage >= THREAD_TOKEN_CEILING) {
    return { allowed: false };
  }
  return { allowed: true };
}
