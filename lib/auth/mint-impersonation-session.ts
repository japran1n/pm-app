// F024 (missions/20260903-portal, AS-052): mints a real Supabase session
// for an arbitrary user, server-side, given only their email. Extracted
// from app/dev-login/route.ts's own generateLink+verify approach (the
// only place in this codebase that already mints a session for an
// identity the caller isn't signing in as themselves) so
// lib/actions/portal-preview.ts can reuse the exact same mechanism
// without copy-pasting it, and so this one function can be mocked in
// tests instead of the whole fetch-a-real-Supabase-endpoint flow.
//
// Deliberately NOT gated to development like dev-login's route is: this
// is the mechanism the whole feature depends on (see F024's spec --
// "mint a scoped session for that client account server-side"). Its own
// caller (`startClientPreview`) is what restricts who may invoke it
// (workspace owner/admin only, re-checked server-side) and what it may be
// used for (a workspace's own active `client` member, verified by the
// caller before this is ever called).
//
// Why `generateLink` + fetch-the-action-link rather than any "admin
// create session" call: the Supabase Admin API has no such endpoint. A
// magic-link is the standard, documented way to mint a real session for
// an arbitrary user id server-side without sending an email (the link is
// generated, not sent) and without ever touching that user's password.
// This produces the client's OWN access/refresh tokens -- indistinguishable
// from what they'd get from a real magic-link sign-in -- which is exactly
// what makes the resulting preview subject to the client's own RLS
// policies rather than a second, hand-rolled copy of them.
import { createAdminClient } from "@/lib/supabase/admin";

export type ImpersonationSession = {
  accessToken: string;
  refreshToken: string;
};

export async function mintImpersonationSession(
  email: string,
): Promise<ImpersonationSession | null> {
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (error || !data?.properties) {
    return null;
  }

  // Same implicit-flow token extraction dev-login/route.ts already uses:
  // generateLink's action_link redirects (302) to Supabase's own /verify
  // endpoint, which itself redirects back with access_token/refresh_token
  // as URL fragment params.
  const verifyResponse = await fetch(data.properties.action_link, {
    redirect: "manual",
  });
  const location = verifyResponse.headers.get("location");
  if (!location) {
    return null;
  }

  const fragment = new URL(location).hash.slice(1);
  const params = new URLSearchParams(fragment);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");

  if (!accessToken || !refreshToken) {
    return null;
  }

  return { accessToken, refreshToken };
}
