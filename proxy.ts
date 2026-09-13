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

export async function proxy(request: NextRequest) {
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
      return NextResponse.redirect(redirectUrl);
    }
    return NextResponse.next({ request });
  }

  const { supabaseResponse, user } = await updateSession(request);

  if (requiresAuth(request.nextUrl.pathname) && !user) {
    const redirectUrl = new URL("/sign-in", request.url);
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public image files (svg, png, jpg, jpeg, gif, webp)
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
