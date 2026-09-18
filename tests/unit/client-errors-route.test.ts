import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Client-side errors (browser crashes in a mounted Client Component)
// otherwise produce no server-side signal at all. This route is the one
// place that gap is closed: every client-rendered error boundary
// (components/route-error.tsx, app/global-error.tsx) posts here so the
// error reaches the same stdout log stream as server-side errors.
const errorMock = vi.fn();
vi.mock("@/lib/observability/logger", () => ({
  logger: { error: errorMock },
}));

async function post(body: unknown) {
  const { POST } = await import("@/app/api/client-errors/route");
  return POST(
    new NextRequest("https://example.com/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/client-errors", () => {
  it("accepts a valid client error payload, logs it, and returns ok: true", async () => {
    errorMock.mockClear();
    const response = await post({
      message: "TypeError: boom",
      digest: "abc123",
      url: "https://example.com/w/acme/board",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock).toHaveBeenCalledWith(
      "client_error",
      expect.objectContaining({ message: "TypeError: boom", digest: "abc123" }),
    );
  });

  it("accepts a payload with only the required message field", async () => {
    errorMock.mockClear();
    const response = await post({ message: "boom" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a payload missing the required message field with 400 and does not log it", async () => {
    errorMock.mockClear();
    const response = await post({ digest: "abc123" });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false });
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized message field with 400", async () => {
    errorMock.mockClear();
    const response = await post({ message: "x".repeat(501) });

    expect(response.status).toBe(400);
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("returns 400 instead of throwing when the request body is not valid JSON", async () => {
    errorMock.mockClear();
    const { POST } = await import("@/app/api/client-errors/route");
    const response = await POST(
      new NextRequest("https://example.com/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      }),
    );

    expect(response.status).toBe(400);
    expect(errorMock).not.toHaveBeenCalled();
  });
});
