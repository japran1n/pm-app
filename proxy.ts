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

// ---------------------------------------------------------------------------
// Content Security Policy (SEC-HTTP-07 / SEC-CONTENT-04 / NX-001)
//
// How the nonce flows:
//   1. `proxy()` mints a fresh nonce per request.
//   2. The CSP (containing `'nonce-…'` in script-src) and `x-nonce` are set
//      on the FORWARDED REQUEST headers (`NextResponse.next({ request: {
//      headers } })`). Next's app renderer parses the request's
//      `content-security-policy` (or `…-report-only`) header and stamps that
//      nonce on every framework/chunk/inline script it emits
//      (node_modules/next/dist/server/app-render/app-render.js
//      `parseRequestHeaders` -> `getScriptNonceFromHeader`).
//   3. app/layout.tsx reads `x-nonce` via `headers()` and puts it on its own
//      scripts (`/theme-init.js`, next-themes' inline bootstrap).
//   4. The same CSP is set on the RESPONSE so the browser enforces/reports it.
//
// Report-Only by default. `CSP_ENFORCE=true` emits the enforcing
// `Content-Security-Policy` header instead (same policy). Do not enable it
// before the browser checklist in the audit notes has been walked — in
// particular, `srcdoc` preview iframes inherit this policy.
// ---------------------------------------------------------------------------

export const CSP_REPORT_ONLY_HEADER = "Content-Security-Policy-Report-Only";
export const CSP_ENFORCE_HEADER = "Content-Security-Policy";

export function cspEnforced(): boolean {
  return process.env.CSP_ENFORCE === "true";
}

export function cspHeaderName(): string {
  return cspEnforced() ? CSP_ENFORCE_HEADER : CSP_REPORT_ONLY_HEADER;
}

/** `https://<ref>.supabase.co` origin from env, or null when unset/invalid. */
function supabaseOrigin(): URL | null {
  try {
    const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
    return raw ? new URL(raw) : null;
  } catch {
    return null;
  }
}

export function buildCsp(
  nonce: string,
  opts: { isDev?: boolean; enforce?: boolean } = {},
): string {
  const isDev = opts.isDev ?? process.env.NODE_ENV === "development";
  const enforce = opts.enforce ?? cspEnforced();

  const sb = supabaseOrigin();
  const supabaseHttp = sb ? sb.origin : "https://*.supabase.co";
  const supabaseWs = sb
    ? `${sb.protocol === "http:" ? "ws:" : "wss:"}//${sb.host}`
    : "wss://*.supabase.co";

  const directives = [
    "default-src 'self'",
    // 'strict-dynamic': scripts loaded by a nonced script (Next's chunk
    // loader, Monaco) are trusted; host allow-lists and 'self' are ignored
    // by CSP3 browsers, so every parser-inserted <script> needs the nonce.
    // Dev only: React uses eval() for server-error stack reconstruction.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Styles: 'unsafe-inline' and NO nonce on purpose. React `style={}`
    // props, Radix/sonner/next-themes/Monaco all inject inline styles or
    // <style> tags without a nonce, and a nonce here would make browsers
    // ignore 'unsafe-inline'. Style injection is a far smaller risk than
    // script injection; scripts stay nonce-locked. next/font self-hosts,
    // so no Google Fonts origin is needed.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // Avatars, link-preview thumbnails and Supabase Storage signed URLs.
    "img-src 'self' data: blob: https:",
    `media-src 'self' blob: data: ${supabaseHttp}`,
    // Monaco / blob workers.
    "worker-src 'self' blob:",
    // Supabase REST/Auth/Storage + Realtime websocket. Dev adds ws: for HMR.
    `connect-src 'self' ${supabaseHttp} ${supabaseWs}${isDev ? " ws: wss:" : ""}`,
    // Site previews in `src` mode frame the customer's own https origin;
    // code-editor / converter previews use srcdoc (inherits this policy).
    "frame-src 'self' https: blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Ignored (with a console warning) in a Report-Only policy.
    ...(enforce && !isDev ? ["upgrade-insecure-requests"] : []),
    "report-uri /api/csp-report",
  ];
  return directives.join("; ");
}

/**
 * Prepares the headers of the request forwarded to the app renderer: drops
 * any client-supplied CSP request header first (Next reads the nonce from
 * the request's CSP, enforcing header preferred, so a forged one must never
 * survive next to ours), then sets ours and `x-nonce`.
 */
export function setCspRequestHeaders(headers: Headers, nonce: string, csp: string): void {
  headers.delete(CSP_ENFORCE_HEADER);
  headers.delete(CSP_REPORT_ONLY_HEADER);
  headers.set(cspHeaderName(), csp);
  headers.set("x-nonce", nonce);
}

/**
 * Sets the CSP header on a response. Called on every response `proxy()`
 * returns (redirects, `NextResponse.next()`, and `updateSession`'s
 * `supabaseResponse`) so the policy applies regardless of which branch
 * produced the response.
 */
export function applyCsp(response: NextResponse, csp: string): NextResponse {
  response.headers.delete(CSP_ENFORCE_HEADER);
  response.headers.delete(CSP_REPORT_ONLY_HEADER);
  response.headers.set(cspHeaderName(), csp);
  return response;
}

export async function proxy(request: NextRequest) {
  // Per-request nonce: a v4 UUID (122 random bits), base64 (matches Next's
  // `'nonce-([A-Za-z0-9+/_-]+={0,2})'` parser).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  const prepareForwarded = (headers: Headers) => setCspRequestHeaders(headers, nonce, csp);

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
      return applyCsp(NextResponse.redirect(redirectUrl), csp);
    }
    const headers = new Headers(request.headers);
    prepareForwarded(headers);
    return applyCsp(NextResponse.next({ request: { headers } }), csp);
  }

  const { supabaseResponse, user } = await updateSession(request, prepareForwarded);

  if (requiresAuth(request.nextUrl.pathname) && !user) {
    const redirectUrl = new URL("/sign-in", request.url);
    return applyCsp(NextResponse.redirect(redirectUrl), csp);
  }

  return applyCsp(supabaseResponse, csp);
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
