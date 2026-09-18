// Next.js 16 renamed `middleware.ts`/`middleware` to `proxy.ts`/`proxy` — see
// tech-decisions.md "Important Next.js 16 breaking changes this mission must
// follow". Do NOT rename this back to middleware.ts.

import { NextResponse, type NextRequest } from "next/server";
import { hasAuthCookie, updateSession } from "@/lib/supabase/proxy-helpers";

/**
 * Pure helper (AS-001): a request path requires an authenticated session if
 * it falls under any workspace-scoped route, i.e. `/w/*`. Kept separate from
 * `proxy()` so the redirect condition can be unit tested without needing to
 * construct a NextRequest/NextResponse pair.
 */
export function requiresAuth(pathname: string): boolean {
  if (pathname === "/w" || pathname.startsWith("/w/")) return true;
  // C3: the client portal is workspace data under a different URL prefix,
  // so it needs the same "no session, no entry" guard. Without this a
  // signed-out visitor reaches the portal layout and gets its own
  // redirect instead of the shared one, which is a second code path doing
  // the same job.
  return pathname === "/portal" || pathname.startsWith("/portal/");
}

/**
 * Sets the Report-Only CSP header and the nonce header on a response. Called
 * on every response `proxy()` returns (redirects, `NextResponse.next()`, and
 * `updateSession`'s `supabaseResponse`) so the policy applies regardless of
 * which branch produced the response.
 */
function applyCsp(response: NextResponse, nonce: string): NextResponse {
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

export async function proxy(request: NextRequest) {
  // Generate a per-request nonce for CSP.
  // crypto.randomUUID() is available in the Edge runtime without any import.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // AS-005/AS-006: a request with no Supabase auth cookie at all cannot have
  // a session — `updateSession`'s network round trip to `getUser()` could
  // only ever come back with "no user" here, which we already know from the
  // cookie's absence. Skip the call and reproduce today's unauthenticated
  // outcome directly. Any request that *does* carry a cookie (even a stale
  // or invalid one) still goes through `updateSession` unchanged, since only
  // the server can verify it.
  if (!hasAuthCookie(request)) {
    if (requiresAuth(request.nextUrl.pathname)) {
      const redirectUrl = new URL("/sign-in", request.url);
      return applyCsp(NextResponse.redirect(redirectUrl), nonce);
    }
    return applyCsp(NextResponse.next({ request }), nonce);
  }

  const { supabaseResponse, user } = await updateSession(request);

  if (requiresAuth(request.nextUrl.pathname) && !user) {
    const redirectUrl = new URL("/sign-in", request.url);
    return applyCsp(NextResponse.redirect(redirectUrl), nonce);
  }

  return applyCsp(supabaseResponse, nonce);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public static asset files (images, scripts, styles, fonts)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|css|woff2?|ttf|eot)).*)",
  ],
};
