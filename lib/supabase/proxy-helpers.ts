// Reusable cookie-sync logic for Next.js 16's app/proxy.ts (renamed from
// middleware.ts — see tech-decisions.md "Important Next.js 16 breaking
// changes"). The exported `proxy` function itself lives in app/proxy.ts
// (added by F010); this file only holds the shared session-refresh helper,
// adapted from @supabase/ssr's documented middleware pattern.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
