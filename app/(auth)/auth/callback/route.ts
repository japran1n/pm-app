// Magic-link callback route (AS-003). Supabase's PKCE flow redirects here
// with a `code` query param after the user clicks the emailed link. We
// exchange it for a session (sets the auth cookies via the server client)
// and redirect onward.
//
// SEC audit 2026-09-24: this route no longer activates pending invites.
// Invites are only accepted by an explicit click on /invites, where
// postSignInPath() sends anyone who has one pending.
//
// Redirects are built on the request's own origin because the session
// cookies were just set for that host; the path itself is either a
// validated same-origin `next` param or computed server-side.

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { postSignInPath } from "@/lib/auth/post-sign-in";
import { safeNextPath } from "@/lib/validation/auth";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const failed = () =>
    NextResponse.redirect(new URL("/sign-in?error=auth_failed", requestUrl.origin));

  if (!code) return failed();

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return failed();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return failed();

  const destination =
    safeNextPath(requestUrl.searchParams.get("next")) ??
    (await postSignInPath(supabase, user));

  return NextResponse.redirect(new URL(destination, requestUrl.origin));
}
