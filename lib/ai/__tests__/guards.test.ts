// F020: unit tests for lib/ai/guards.ts's per-user rate limiter and
// per-thread token ceiling.

import { beforeEach, describe, expect, it } from "vitest";

import { THREAD_TOKEN_CEILING, checkRateLimit, checkTokenCeiling, __resetRateLimitStoreForTests } from "@/lib/ai/guards";

beforeEach(() => {
  __resetRateLimitStoreForTests();
});

describe("F020 checkRateLimit", () => {
  it("AS-046: allows the first request for a user", () => {
    const result = checkRateLimit("user-1", 0);
    expect(result.allowed).toBe(true);
  });

  it("AS-046: allows requests 2 through 20 within the same window", () => {
    const now = 0;
    for (let i = 0; i < 20; i++) {
      const result = checkRateLimit("user-1", now + i);
      expect(result.allowed).toBe(true);
    }
  });

  it("AS-046: blocks the 21st request in the same 60-second window", () => {
    const now = 0;
    for (let i = 0; i < 20; i++) {
      checkRateLimit("user-1", now + i);
    }
    const result = checkRateLimit("user-1", now + 20);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("AS-046: allows requests again after the window resets", () => {
    const now = 0;
    for (let i = 0; i < 20; i++) {
      checkRateLimit("user-1", now + i);
    }
    expect(checkRateLimit("user-1", now + 20).allowed).toBe(false);

    // 60_001ms later — past the 1-minute window.
    const result = checkRateLimit("user-1", now + 60_001);
    expect(result.allowed).toBe(true);
  });

  it("AS-046: rate limits are tracked independently per user", () => {
    const now = 0;
    for (let i = 0; i < 20; i++) {
      checkRateLimit("user-1", now + i);
    }
    expect(checkRateLimit("user-1", now + 20).allowed).toBe(false);
    // A different user's own budget is untouched.
    expect(checkRateLimit("user-2", now + 20).allowed).toBe(true);
  });
});

describe("F020 checkTokenCeiling", () => {
  it("AS-046: allows a thread well under the ceiling", () => {
    expect(checkTokenCeiling(0).allowed).toBe(true);
    expect(checkTokenCeiling(THREAD_TOKEN_CEILING - 1).allowed).toBe(true);
  });

  it("AS-046: blocks a thread at the ceiling, with a thread_limit-appropriate result", () => {
    const result = checkTokenCeiling(THREAD_TOKEN_CEILING);
    expect(result.allowed).toBe(false);
  });

  it("AS-046: blocks a thread over the ceiling", () => {
    const result = checkTokenCeiling(THREAD_TOKEN_CEILING + 1);
    expect(result.allowed).toBe(false);
  });
});
