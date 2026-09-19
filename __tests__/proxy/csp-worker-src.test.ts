import { describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { applyCsp } from "@/proxy";

// TH-175: worker-src 'self' blob: must be present in the Report-Only CSP so
// Monaco's web workers (loaded via blob: URLs) are not silently reported as
// violations, without removing any existing directive.
describe("applyCsp", () => {
  it("TH_175_adds_worker_src_directive_without_removing_existing_directives", () => {
    const response = applyCsp(NextResponse.next(), "test-nonce");
    const header = response.headers.get("Content-Security-Policy-Report-Only");

    expect(header).not.toBeNull();
    expect(header).toContain("worker-src 'self' blob:");

    // Assert no existing directives were removed.
    const expectedExistingDirectives = [
      "default-src 'self'",
      "script-src 'self' 'nonce-test-nonce' 'strict-dynamic'",
      "style-src 'self' 'nonce-test-nonce' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
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
