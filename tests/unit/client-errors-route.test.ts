import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Client-side errors (browser crashes in a mounted Client Component)
// otherwise produce no server-side signal at all. This route is the one
// place that gap is closed: every client-rendered error boundary
// (components/route-error.tsx, app/global-error.tsx) posts here so the
// error reaches the same stdout log stream as server-side errors.
// SEC-HTTP-11: bounded body, nested (non-overriding) log fields, redacted
// URL, per-IP rate limit.
const errorMock = vi.fn();
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: errorMock, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

let ipCounter = 0;
function freshIp() {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

async function post(body: unknown, ip = freshIp(), raw?: string) {
  const { POST } = await import("@/app/api/client-errors/route");
  return POST(
    new NextRequest("https://example.com/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

beforeEach(() => errorMock.mockClear());

describe("POST /api/client-errors", () => {
  it("accepts a valid client error payload, logs it nested under `client`, and returns ok: true", async () => {
    const response = await post({
      message: "TypeError: boom",
      digest: "abc123",
      url: "https://example.com/w/acme/board?token=secret#frag",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock).toHaveBeenCalledWith("client_error", {
      client: {
        message: "TypeError: boom",
        digest: "abc123",
        url: "https://example.com/w/acme/board",
      },
    });
  });

  it("accepts a payload with only the required message field", async () => {
    const response = await post({ message: "boom" });
    expect(response.status).toBe(200);
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a payload missing the required message field with 400 and does not log it", async () => {
    const response = await post({ digest: "abc123" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("clips an overlong message instead of dropping the report", async () => {
    const response = await post({ message: "x".repeat(3000) });
    expect(response.status).toBe(200);
    const logged = errorMock.mock.calls[0][1] as { client: { message: string } };
    expect(logged.client.message).toHaveLength(500);
  });

  it("rejects a body over 8KB with 413 and does not log it", async () => {
    const response = await post({ message: "x".repeat(9000) });
    expect(response.status).toBe(413);
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("returns 400 instead of throwing when the request body is not valid JSON", async () => {
    const response = await post(undefined, freshIp(), "not json");
    expect(response.status).toBe(400);
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("rate-limits a single IP", async () => {
    const ip = freshIp();
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++) statuses.push((await post({ message: "m" }, ip)).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(20)).toEqual([429, 429]);
  });
});
