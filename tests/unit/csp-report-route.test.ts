import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// SEC-HTTP-11: /api/csp-report is unauthenticated; it must cap the body,
// keep only known clipped fields, strip query strings, and rate-limit.
const warnMock = vi.fn();
vi.mock("@/lib/observability/logger", () => ({
  logger: { warn: warnMock, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

let ipCounter = 0;
const freshIp = () => `10.1.0.${++ipCounter}`;

async function post(body: string, ip = freshIp(), contentType = "application/csp-report") {
  const { POST } = await import("@/app/api/csp-report/route");
  return POST(
    new NextRequest("https://example.com/api/csp-report", {
      method: "POST",
      headers: { "Content-Type": contentType, "x-forwarded-for": ip },
      body,
    }),
  );
}

beforeEach(() => warnMock.mockClear());

describe("POST /api/csp-report", () => {
  it("logs a legacy report with only known, redacted fields", async () => {
    const response = await post(
      JSON.stringify({
        "csp-report": {
          "document-uri": "https://app.example.com/auth/callback?code=SECRET",
          "violated-directive": "script-src-elem",
          "blocked-uri": "https://evil.example/x.js?q=1",
          "line-number": 12,
          evil: "x".repeat(100),
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(warnMock).toHaveBeenCalledTimes(1);
    const [, ctx] = warnMock.mock.calls[0] as [string, { report: Record<string, unknown> }];
    expect(ctx.report.documentUri).toBe("https://app.example.com/auth/callback");
    expect(ctx.report.blockedUri).toBe("https://evil.example/x.js");
    expect(ctx.report.directive).toBe("script-src-elem");
    expect(ctx.report.line).toBe("12");
    expect(JSON.stringify(ctx)).not.toContain("SECRET");
    expect(JSON.stringify(ctx)).not.toContain("evil\"");
  });

  it("accepts a Reporting API batch", async () => {
    const response = await post(
      JSON.stringify([
        { type: "csp-violation", body: { documentURL: "https://a.example/p", effectiveDirective: "img-src", blockedURL: "inline" } },
      ]),
      freshIp(),
      "application/reports+json",
    );
    expect(response.status).toBe(204);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it("rejects bodies over 8KB with 413 without logging", async () => {
    const response = await post(
      JSON.stringify({ "csp-report": { "script-sample": "x".repeat(10_000) } }),
    );
    expect(response.status).toBe(413);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid shape or non-JSON with 400", async () => {
    expect((await post(JSON.stringify({ hello: 1 }))).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("rate-limits a single IP", async () => {
    const ip = freshIp();
    const body = JSON.stringify({ "csp-report": { "violated-directive": "img-src" } });
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await post(body, ip)).status;
    expect(last).toBe(429);
  });
});
