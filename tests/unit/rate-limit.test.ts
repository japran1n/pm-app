import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));
vi.mock("@/lib/observability/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  bumpLocalWindow,
  checkRateLimit,
  clientIpFromHeaders,
  keyToUuid,
  resetRateLimitsForTests,
} from "@/lib/rate-limit";

const rule = { bucket: "t", limit: 3, windowSeconds: 60 };

beforeEach(() => {
  resetRateLimitsForTests();
  rpcMock.mockReset();
});

describe("bumpLocalWindow", () => {
  it("allows up to the limit within a window, then denies", () => {
    const now = 1_000_000_000_000;
    expect([1, 2, 3, 4].map(() => bumpLocalWindow(rule, "k", now))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("resets on the next window and isolates keys and buckets", () => {
    const now = 60_000 * 100;
    for (let i = 0; i < 4; i++) bumpLocalWindow(rule, "k", now);
    expect(bumpLocalWindow(rule, "k", now)).toBe(false);
    expect(bumpLocalWindow(rule, "other", now)).toBe(true);
    expect(bumpLocalWindow({ ...rule, bucket: "t2" }, "k", now)).toBe(true);
    expect(bumpLocalWindow(rule, "k", now + 60_000)).toBe(true);
  });
});

describe("checkRateLimit", () => {
  it("in-process mode never touches the database", async () => {
    for (let i = 0; i < 3; i++) expect(await checkRateLimit(rule, "ip")).toBe(true);
    expect(await checkRateLimit(rule, "ip")).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("distributed mode uses the RPC with a hashed uuid key", async () => {
    rpcMock.mockResolvedValue({ data: false, error: null });
    const allowed = await checkRateLimit({ ...rule, distributed: true }, "a@b.se");
    expect(allowed).toBe(false);
    expect(rpcMock).toHaveBeenCalledWith("bump_extension_rate_limit", {
      p_user_id: keyToUuid("t", "a@b.se"),
      p_bucket: "t",
      p_limit: 3,
      p_window_seconds: 60,
    });
    // The raw key never reaches the DB.
    expect(JSON.stringify(rpcMock.mock.calls)).not.toContain("a@b.se");
  });

  it("falls back to the in-process window when the RPC errors or throws", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    rpcMock.mockRejectedValue(new Error("network"));
    const d = { ...rule, distributed: true };
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await checkRateLimit(d, "k"));
    expect(results).toEqual([true, true, true, false]);
  });
});

describe("keyToUuid", () => {
  it("is deterministic, UUID-shaped and bucket-scoped", () => {
    const a = keyToUuid("b", "k");
    expect(a).toBe(keyToUuid("b", "k"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(keyToUuid("b2", "k")).not.toBe(a);
  });
});

describe("clientIpFromHeaders", () => {
  it("uses the first x-forwarded-for hop, then x-real-ip, else unknown", () => {
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe(
      "1.2.3.4",
    );
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
