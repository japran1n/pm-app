// Server-side email-link verification (GAP5-06). Supabase's recommended
// SSR flow for links that are not started in this browser — invite emails
// sent by `auth.admin.inviteUserByEmail` have no PKCE verifier, so they can
// never reach /auth/callback with a usable `code`. The email template links
// here instead:
//
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
//
// `verifyOtp` sets the session cookies; the user then lands on /invites
// (if anything is pending) to Accept/Decline explicitly — nothing is
// activated by following the link alone.

import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { postSignInPath } from "@/lib/auth/post-sign-in";
import { confirmOtpTypeSchema, safeNextPath } from "@/lib/validation/auth";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = confirmOtpTypeSchema.safeParse(requestUrl.searchParams.get("type"));
  const failed = () =>
    NextResponse.redirect(new URL("/sign-in?error=auth_failed", requestUrl.origin));

  if (!tokenHash || !type.success) return failed();

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    type: type.data,
    token_hash: tokenHash,
  });
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
