// Magic-link callback route (AS-003). Supabase's PKCE/OTP flow redirects
// here with a `code` query param after the user clicks the emailed link.
// We exchange it for a session (sets the auth cookies via the server
// client) and redirect onward.
//
// F013: workspaces/workspace_members now exist (F011/F012), so the
// "temporary redirect to '/'" this route shipped with is resolved here —
// AS-005: zero memberships -> /onboarding; AS-006-adjacent: at least one
// membership -> that workspace's /w/[slug] (first active membership, most
// recently created).
//
// Next.js 16: searchParams-equivalent (the request URL) is read via
// `request.url`; no awaited params needed for Route Handlers.

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { activateInvitedMemberships } from "@/lib/actions/invites";
import { getDefaultWorkspaceSlug } from "@/lib/queries/workspaces";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(
      new URL("/sign-in?error=auth_failed", requestUrl.origin),
    );
  }

  // F016 (AS-008, AS-009): before routing by membership count, claim any
  // pending invites for this user's email so they're counted as active
  // below. A user invited to multiple workspaces gets all of them
  // activated here.
  if (user.email) {
    await activateInvitedMemberships(user.id, user.email);
  }

  const defaultWorkspace = await getDefaultWorkspaceSlug(supabase, user.id);

  if (defaultWorkspace) {
    // Portal clients (role "client") don't get the agency-facing
    // "Create your workspace" flow or a `/w/*` route — they land in the
    // client portal for their workspace instead.
    if (defaultWorkspace.role === "client") {
      return NextResponse.redirect(
        new URL(`/portal/${defaultWorkspace.slug}`, requestUrl.origin),
      );
    }

    return NextResponse.redirect(
      new URL(`/w/${defaultWorkspace.slug}`, requestUrl.origin),
    );
  }

  return NextResponse.redirect(new URL("/onboarding", requestUrl.origin));
}
