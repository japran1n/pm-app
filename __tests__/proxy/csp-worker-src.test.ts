import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { applyCsp, buildCsp } from "@/proxy";

// TH-175: worker-src 'self' blob: must be present in the CSP so Monaco's web
// workers (loaded via blob: URLs) are not reported/blocked, without removing
// any other directive. SEC-HTTP-07 reshaped the policy (style-src no longer
// carries a nonce — see proxy.ts); the baseline directives are asserted here.
describe("applyCsp", () => {
  it("TH_175_adds_worker_src_directive_without_removing_existing_directives", () => {
    const csp = buildCsp("test-nonce", { isDev: false, enforce: false });
    const response = applyCsp(NextResponse.next(), csp);
    const header = response.headers.get("Content-Security-Policy-Report-Only");

    expect(header).not.toBeNull();
    expect(header).toContain("worker-src 'self' blob:");

    const expectedExistingDirectives = [
      "default-src 'self'",
      "script-src 'self' 'nonce-test-nonce' 'strict-dynamic'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https:",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "report-uri /api/csp-report",
    ];

    for (const directive of expectedExistingDirectives) {
      expect(header).toContain(directive);
    }
  });
});
