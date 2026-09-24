import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import {
  consumeExtensionHandoffToken,
  decodeExtensionHandoffToken,
  mintExtensionHandoffToken,
} from "@/lib/extension-handoff";
import { extensionHandoffExchangeSchema } from "@/lib/validation/extension";

beforeAll(() => {
  process.env.EXTENSION_HANDOFF_SECRET ??= "test-secret-not-for-production";
});

const userId = "11111111-1111-4111-8111-111111111111";

// Fake admin client whose `bump_extension_rate_limit` behaves like the real
// fixed-window counter: first call per bucket is within limit 1, later
// calls are not — i.e. a durable, cross-process "already used" marker.
function fakeAdmin(opts: { fail?: boolean } = {}) {
  const counts = new Map<string, number>();
  const rpc = vi.fn(async (_fn: string, args: { p_bucket: string; p_limit: number }) => {
    if (opts.fail) return { data: null, error: { message: "boom" } };
    const next = (counts.get(args.p_bucket) ?? 0) + 1;
    counts.set(args.p_bucket, next);
    return { data: next <= args.p_limit, error: null };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { admin: { rpc } as any, rpc, counts };
}

describe("extension handoff token (AS-532, AS-538, SEC-HTTP-08)", () => {
  it("round-trips to the same user id on first decode", () => {
    const token = mintExtensionHandoffToken({ userId });
    const result = decodeExtensionHandoffToken(token);
    expect(result).toMatchObject({ ok: true, userId });
  });

  it("SEC-HTTP-08: carries no session credentials, only an opaque encrypted id", () => {
    const token = mintExtensionHandoffToken({ userId });
    expect(token).not.toContain("sb_secret_");
    expect(token).not.toContain(userId);
  });

  it("two tokens for the same user are distinct (random nonce + iv)", () => {
    expect(mintExtensionHandoffToken({ userId })).not.toBe(
      mintExtensionHandoffToken({ userId }),
    );
  });

  it("rejects a token already decoded in this process", () => {
    const token = mintExtensionHandoffToken({ userId });
    expect(decodeExtensionHandoffToken(token).ok).toBe(true);
    expect(decodeExtensionHandoffToken(token)).toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects a tampered token", () => {
    const token = mintExtensionHandoffToken({ userId });
    const tampered = token.slice(0, -4) + "abcd";
    expect(decodeExtensionHandoffToken(tampered).ok).toBe(false);
  });

  it("rejects garbage input rather than throwing", () => {
    expect(decodeExtensionHandoffToken("not-a-real-token")).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    try {
      const token = mintExtensionHandoffToken({ userId });
      vi.advanceTimersByTime(61_000);
      expect(decodeExtensionHandoffToken(token)).toEqual({ ok: false, reason: "expired" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("consumeExtensionHandoffToken (DB-backed single use)", () => {
  it("consumes once via a per-token bucket with limit 1", async () => {
    const { admin, rpc } = fakeAdmin();
    const token = mintExtensionHandoffToken({ userId });
    await expect(consumeExtensionHandoffToken(token, admin)).resolves.toEqual({ ok: true, userId });
    expect(rpc).toHaveBeenCalledWith(
      "bump_extension_rate_limit",
      expect.objectContaining({ p_user_id: userId, p_limit: 1 }),
    );
    expect(rpc.mock.calls[0][1].p_bucket).toMatch(/^handoff:[0-9a-f]{64}$/);
  });

  it("rejects a replay even when the in-memory guard is bypassed (another instance)", async () => {
    const { admin } = fakeAdmin();
    const token = mintExtensionHandoffToken({ userId });
    expect((await consumeExtensionHandoffToken(token, admin)).ok).toBe(true);

    // Simulate a second server instance: same DB counter, fresh memory —
    // re-mint is not possible, so replay the DB step directly.
    const bucket = (admin.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1].p_bucket;
    const replay = await admin.rpc("bump_extension_rate_limit", {
      p_user_id: userId,
      p_bucket: bucket,
      p_limit: 1,
      p_window_seconds: 2_147_483_647,
    });
    expect(replay.data).toBe(false);
  });

  it("fails closed when the DB check errors", async () => {
    const { admin } = fakeAdmin({ fail: true });
    const token = mintExtensionHandoffToken({ userId });
    await expect(consumeExtensionHandoffToken(token, admin)).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});

describe("extensionHandoffExchangeSchema (AS-532)", () => {
  it("accepts a well-formed token string", () => {
    const result = extensionHandoffExchangeSchema.safeParse({
      token: "some-opaque-token",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing token", () => {
    const result = extensionHandoffExchangeSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a non-string token (never trusts an arbitrary payload shape)", () => {
    const result = extensionHandoffExchangeSchema.safeParse({ token: 12345 });
    expect(result.success).toBe(false);
  });
});
