import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Generate a per-request nonce for CSP.
  // crypto.randomUUID() is available in the Edge runtime without any import.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "report-uri /api/csp-report",
  ].join("; ");

  // Report-Only: violations are logged but nothing is blocked.
  // Switch to Content-Security-Policy once the policy is validated.
  response.headers.set("Content-Security-Policy-Report-Only", csp);
  // Expose the nonce so server components can inject it into <script> / <style>.
  response.headers.set("x-nonce", nonce);

  return response;
}

export const config = {
  matcher: [
    // Apply to all routes except static files and Next.js internals.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|woff2?|ttf|eot)).*)",
  ],
};
