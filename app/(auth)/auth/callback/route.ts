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

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id, created_at")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (membershipError) {
    console.error(
      "auth callback: failed to look up workspace memberships:",
      membershipError,
    );
  }

  let slug: string | undefined;
  if (membership) {
    const { data: workspace, error: workspaceError } = await supabase
      .from("workspaces")
      .select("slug")
      .eq("id", membership.workspace_id)
      .maybeSingle();
    if (workspaceError) {
      console.error(
        "auth callback: failed to look up workspace slug:",
        workspaceError,
      );
    }
    slug = workspace?.slug;
  }

  if (slug) {
    return NextResponse.redirect(new URL(`/w/${slug}`, requestUrl.origin));
  }

  return NextResponse.redirect(new URL("/onboarding", requestUrl.origin));
}
