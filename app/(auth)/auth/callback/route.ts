// Magic-link callback route (AS-003). Supabase's PKCE/OTP flow redirects
// here with a `code` query param after the user clicks the emailed link.
// We exchange it for a session (sets the auth cookies via the server
// client) and redirect onward.
//
// Temporary redirect target: workspaces/workspace_members tables don't
// exist yet (F011/F012 land later in this milestone), so "redirect to the
// user's default workspace" (per the draft scope) cannot be implemented
// against real data yet. We redirect to '/' on success for now. Once
// F011-F013 land, this should be revisited to redirect to the user's
// default workspace or '/onboarding' if they have none (see handoff).
//
// Next.js 16: searchParams-equivalent (the request URL) is read via
// `request.url`; no awaited params needed for Route Handlers.

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(
      new URL("/sign-in?error=auth_failed", requestUrl.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/sign-in?error=auth_failed", requestUrl.origin),
    );
  }

  // TODO(F011-F013): redirect to the user's default workspace, or
  // '/onboarding' if they have none, once workspace tables exist.
  return NextResponse.redirect(new URL("/", requestUrl.origin));
}
