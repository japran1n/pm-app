"use server";

import { redirect } from "next/navigation";

import { cookies } from "next/headers";

import { createClient, isPortalPreview } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { passwordSignInSchema, signInSchema } from "@/lib/validation/auth";
import { logger } from "@/lib/observability/logger";
import { appUrl, isPasswordLoginEnabled } from "@/lib/env";
import { checkRateLimit, clientIpFromRequest, type RateLimitRule } from "@/lib/rate-limit";
import {
  PORTAL_PREVIEW_ACCESS_COOKIE,
  PORTAL_PREVIEW_REFRESH_COOKIE,
  PORTAL_PREVIEW_LABEL_COOKIE,
  PORTAL_PREVIEW_CLIENT_MEMBER_COOKIE,
} from "@/lib/portal/preview-cookies";
import type { ActionOutcome } from "@/lib/actions/authz";

export type SignInResult = ActionOutcome;

// SEC-HTTP-09: application-level throttling for the unauthenticated sign-in
// actions, keyed by client IP and by the submitted identifier (lower-cased;
// hashed before it reaches the DB — see lib/rate-limit.ts). Cross-instance
// via the shared `bump_extension_rate_limit` counter, with an in-process
// fallback. Supabase Auth's own limits still apply behind this.
const RATE_WINDOW_SECONDS = 15 * 60;
const SIGN_IN_LIMITS = {
  magicLinkIp: { bucket: "auth_magic_link_ip", limit: 20, windowSeconds: RATE_WINDOW_SECONDS, distributed: true },
  magicLinkEmail: { bucket: "auth_magic_link_email", limit: 5, windowSeconds: RATE_WINDOW_SECONDS, distributed: true },
  passwordIp: { bucket: "auth_password_ip", limit: 30, windowSeconds: RATE_WINDOW_SECONDS, distributed: true },
  passwordIdentifier: { bucket: "auth_password_identifier", limit: 10, windowSeconds: RATE_WINDOW_SECONDS, distributed: true },
} satisfies Record<string, RateLimitRule>;

const RATE_LIMITED_ERROR = "Too many attempts. Please wait a few minutes and try again.";

// Both keys are always bumped (no short-circuit) so an attacker rotating
// identifiers from one IP still spends the IP budget.
async function withinSignInLimits(
  ipRule: RateLimitRule,
  idRule: RateLimitRule,
  identifier: string,
): Promise<boolean> {
  const ip = await clientIpFromRequest();
  const [ipOk, idOk] = await Promise.all([
    checkRateLimit(ipRule, ip),
    checkRateLimit(idRule, identifier.trim().toLowerCase()),
  ]);
  return ipOk && idOk;
}

// Requests a Supabase Auth magic link for the given email (AS-002).
//
// Rate limiting: Supabase Auth has built-in rate limits on the magic-link
// (OTP) send endpoint — by default a fixed number of emails per hour per
// address and a global project-level email rate limit — enforced
// server-side by Supabase itself (AS-145). SEC-HTTP-09 adds a per-IP and
// per-email application limit in front of it (`withinSignInLimits` above),
// which also bounds the admin invite lookup below.
export async function signInWithMagicLink(
  _prevState: SignInResult | null,
  formData: FormData,
): Promise<SignInResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Enter a valid email address.",
    };
  }

  if (!(await withinSignInLimits(SIGN_IN_LIMITS.magicLinkIp, SIGN_IN_LIMITS.magicLinkEmail, parsed.data.email))) {
    return { ok: false, error: RATE_LIMITED_ERROR };
  }

  const supabase = await createClient();

  // P2-1: open self-registration guard. `shouldCreateUser: true`
  // unconditionally let anyone mint a brand-new account off the sign-in
  // form. Gate account creation on a pending workspace invite for this
  // email (admin client, bypassing RLS since `workspace_members` has no
  // SELECT policy for an anonymous/unrelated caller). Existing accounts
  // still get their magic link either way — this only blocks *new*
  // signups for emails with no invite.
  //
  // SEC-ACT1-13 / GAP5-12: an email may have pending invites to several
  // workspaces; `.limit(1)` + a length check (not `maybeSingle`, which
  // errors on 2+ rows and silently blocked signup) answers "any invite?".
  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: pre-authentication invite lookup for an anonymous sign-in caller; workspace_members has no SELECT policy for an unauthenticated caller, so RLS cannot be used here and there is no signed-in user yet to check
  const admin = createAdminClient();
  const { data: pendingInvites, error: inviteLookupError } = await admin
    .from("workspace_members")
    .select("id")
    .eq("invited_email", parsed.data.email)
    .eq("status", "invited")
    .is("user_id", null)
    .limit(1);

  if (inviteLookupError) {
    logger.error("signInWithMagicLink: invite lookup failed", { error: inviteLookupError });
  }
  const hasPendingInvite = (pendingInvites?.length ?? 0) > 0;

  // GAP5-09: the link target comes from configuration, never from the
  // request's Origin/Host headers.
  let emailRedirectTo: string;
  try {
    emailRedirectTo = `${appUrl()}/auth/callback`;
  } catch (configError) {
    logger.error("signInWithMagicLink: app URL not configured", { error: configError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: hasPendingInvite,
      emailRedirectTo,
    },
  });

  if (error) {
    // SEC-HTTP-10: never branch the response on the outcome. For an email
    // with no account (and no invite) Supabase rejects the request
    // ("Signups not allowed for otp"); for an existing account it can fail
    // on send/rate limits. Surfacing either would reveal whether the
    // address has an account, so every outcome after input validation
    // returns the same `{ ok: true }`. Detail is logged server-side only.
    logger.warn("signInWithMagicLink: OTP request not sent", {
      code: error.code,
      status: error.status,
    });
  }

  return { ok: true };
}

// Signs the current user out (AS-022): calling supabase.auth.signOut()
// against the server client instructs @supabase/ssr to clear the
// sb-*-auth-token session cookies from the response, fully ending the
// server-side session (not just local client state). After the cookies are
// cleared, redirect to /sign-in — combined with proxy.ts's `requiresAuth`
// guard (AS-001), any subsequent request to a /w/* route (including via
// back-navigation, since Next.js Server Components re-fetch on every
// request rather than serving from a client-side bfcache) is redirected to
// /sign-in instead of rendering cached workspace data.
// F024b (missions/20260903-portal, AS-052 remediation): `workspaceSlug` is
// optional and only meaningful under a client preview session -- see the
// preview branch below. Every existing team-app caller
// (components/nav/app-sidebar.tsx's own SignOutButton) keeps calling
// `signOut()` with no arguments, unaffected.
// FU-7 (F021): on a Supabase error this now RETURNS `{ ok: false, error }`
// instead of redirecting, so the user is never told they signed out when the
// session may still be live. On success (and in preview exit) it redirects
// and never returns.
export async function signOut(
  workspaceSlug?: string,
): Promise<{ ok: false; error: string }> {
  // Under a client preview session, `createClient()` (lib/supabase/server.ts)
  // returns the IMPERSONATED client -- calling `supabase.auth.signOut()`
  // in that state would revoke the real client's own Supabase session
  // server-side (logging the actual customer out as a side effect of an
  // admin previewing), while leaving the preview cookies in place and
  // never touching the previewer's own `/`-scoped session at all. None of
  // that is "signing the previewer out" in any sense, so it must not
  // happen: exit the preview instead (clear only the path-scoped preview
  // cookies) and send the previewer back to their own admin surface,
  // fully signed in as themselves throughout.
  if (await isPortalPreview()) {
    const cookieStore = await cookies();
    const expired = { path: "/portal" as const, maxAge: 0 };
    cookieStore.set(PORTAL_PREVIEW_ACCESS_COOKIE, "", expired);
    cookieStore.set(PORTAL_PREVIEW_REFRESH_COOKIE, "", expired);
    cookieStore.set(PORTAL_PREVIEW_LABEL_COOKIE, "", expired);
    cookieStore.set(PORTAL_PREVIEW_CLIENT_MEMBER_COOKIE, "", expired);
    redirect(
      workspaceSlug ? `/w/${workspaceSlug}/preview-as-client` : `/sign-in`,
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();

  if (error) {
    // Log detail server-side only; never surface raw Supabase error text.
    logger.error("signOut failed", { error: error });
    return { ok: false, error: "Couldn't sign out. Please try again." };
  }

  redirect("/sign-in");
}

// --- Password sign-in (testing / demo accounts) -----------------------------
//
// The magic-link flow above stays the primary production path. This adds a
// second, ordinary email-or-username + password path so the app can be
// exercised repeatedly without an inbox and without hitting Supabase's
// magic-link send rate limit (the same problem app/dev-login/route.ts
// works around, but usable from the real sign-in screen and from a
// deployed preview, not only NODE_ENV=development).
//
// Username support: usernames live in each account's Supabase Auth
// `user_metadata.username` (written by scripts/seed-demo.mjs), not in a
// `profiles` column — no migration is needed and nothing about the
// existing schema changes. Resolving one to its email requires the admin
// client, so that lookup is deliberately gated behind
// ALLOW_USERNAME_LOGIN=true (defaulting to on in development only): it is
// a convenience for testing, not a production auth surface. An identifier
// containing "@" is always treated as an email and never touches the
// admin client.

export type PasswordSignInResult = ActionOutcome;

function usernameLoginEnabled(): boolean {
  if (process.env.ALLOW_USERNAME_LOGIN === "true") return true;
  if (process.env.ALLOW_USERNAME_LOGIN === "false") return false;
  return process.env.NODE_ENV === "development";
}

// Guards the password sign-in Server Action itself. Unlike the client UI
// (which may simply hide the password tab), a Server Action remains directly
// callable regardless of what the UI renders, so the action needs its own
// check. Defaults to enabled so the team can keep using it in the meantime;
// set PASSWORD_LOGIN_ENABLED=false in production when this path should be
// fully closed off.
function passwordLoginEnabled(): boolean {
  // SEC-HTTP-13: parsed via lib/env.ts (default ON when unset).
  return isPasswordLoginEnabled();
}

// Maps a bare username onto the email of the account that claims it.
// Returns null when the username is unknown — the caller reports the same
// generic "invalid credentials" message either way, so this never becomes
// a username-enumeration oracle.
async function resolveUsernameToEmail(username: string): Promise<string | null> {
  const wanted = username.trim().toLowerCase();

  // GoTrue's admin user list supports a `filter` query param (a substring
  // match over email) that the JS SDK does not expose. Filtering by the
  // username narrows thousands of accounts down to a handful server-side;
  // the exact `user_metadata.username` comparison then happens here, so a
  // partial email match never signs anyone into the wrong account.
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?filter=${encodeURIComponent(
      wanted,
    )}&per_page=50`,
    {
      headers: {
        apikey: process.env.SUPABASE_SECRET_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY!}`,
      },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    logger.error("resolveUsernameToEmail lookup failed", { error: response.status });
    return null;
  }

  const body = (await response.json()) as {
    users?: Array<{ email?: string; user_metadata?: { username?: string } }>;
  };

  const match = (body.users ?? []).find(
    (u) => String(u.user_metadata?.username ?? "").toLowerCase() === wanted,
  );

  return match?.email ?? null;
}

export async function signInWithPassword(
  _prevState: PasswordSignInResult | null,
  formData: FormData,
): Promise<PasswordSignInResult> {
  if (!passwordLoginEnabled()) return { ok: false, error: "Password login is disabled." };

  const parsed = passwordSignInSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check your details and try again.",
    };
  }

  const { identifier, password } = parsed.data;

  if (!(await withinSignInLimits(SIGN_IN_LIMITS.passwordIp, SIGN_IN_LIMITS.passwordIdentifier, identifier))) {
    return { ok: false, error: RATE_LIMITED_ERROR };
  }

  let email: string | null = identifier.includes("@") ? identifier : null;
  if (!email) {
    if (!usernameLoginEnabled()) {
      return { ok: false, error: "Enter the email address for your account." };
    }
    email = await resolveUsernameToEmail(identifier);
  }

  if (!email) {
    // Same message as a wrong password: no enumeration signal.
    return { ok: false, error: "Invalid email/username or password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    logger.error("signInWithPassword failed", { error: error.message });
    return { ok: false, error: "Invalid email/username or password." };
  }

  // Session cookies are already written by the SSR client at this point;
  // /onboarding does the membership check and forwards to the user's
  // workspace (or shows the create-workspace form for a brand-new account).
  redirect("/onboarding");
}
