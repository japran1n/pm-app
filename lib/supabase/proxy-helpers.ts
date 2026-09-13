// Reusable cookie-sync logic for Next.js 16's app/proxy.ts (renamed from
// middleware.ts — see tech-decisions.md "Important Next.js 16 breaking
// changes"). The exported `proxy` function itself lives in app/proxy.ts
// (added by F010); this file only holds the shared session-refresh helper,
// adapted from @supabase/ssr's documented middleware pattern.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Derives the Supabase SSR auth cookie's base name, e.g.
 * `sb-qcipqonnqajmazdbysow-auth-token`, from the project's Supabase URL.
 * The project ref is the subdomain of `NEXT_PUBLIC_SUPABASE_URL`
 * (`https://<ref>.supabase.co`).
 */
function getAuthCookieBaseName(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const projectRef = url.replace(/^https?:\/\//, "").split(".")[0];
  return `sb-${projectRef}-auth-token`;
}

/**
 * True if the request carries any cookie belonging to the Supabase SSR auth
 * cookie family for this project — the unchunked cookie itself, or any of
 * its chunked suffixes (`.0`, `.1`, ...) that @supabase/ssr writes when the
 * session is too large for a single cookie. This is a presence check only;
 * it does not validate the cookie's contents. A present-but-invalid cookie
 * must still go through `updateSession` to be verified against the server.
 */
export function hasAuthCookie(request: NextRequest): boolean {
  const baseName = getAuthCookieBaseName();
  return request.cookies.getAll().some(({ name }) => {
    if (name === baseName) return true;
    // Chunked cookie names look like `<baseName>.0`, `<baseName>.1`, etc.
    return name.startsWith(`${baseName}.`) && /^\d+$/.test(name.slice(baseName.length + 1));
  });
}

/**
 * Refreshes the Supabase auth session for an incoming request and returns
 * a NextResponse carrying the refreshed cookies. Call this from app/proxy.ts's
 * exported `proxy(request)` function and return its result (or a redirect
 * built from `supabaseResponse.cookies`, per F010's auth-guard logic).
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({
            request,
          });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and
  // supabase.auth.getUser() — this refreshes the session token.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user, supabase };
}
