"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { signInSchema } from "@/lib/validation/auth";

export type SignInResult =
  | { ok: true }
  | { ok: false; error: string };

// Requests a Supabase Auth magic link for the given email (AS-002).
//
// Rate limiting: no custom throttling is implemented here. Supabase Auth
// has built-in rate limits on the magic-link (OTP) send endpoint — by
// default a fixed number of emails per hour per address and a global
// project-level email rate limit — which is enforced server-side by
// Supabase itself before this action's request ever succeeds. Per
// AS-145, that built-in throttling is relied upon and documented here
// rather than reimplemented in application code.
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

  const headerList = await headers();
  const origin =
    headerList.get("origin") ??
    `https://${headerList.get("host") ?? "localhost:3000"}`;

  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    // Log detail server-side only; never surface raw Supabase error text
    // to the client (AS-146/AS-148 pattern: generic message on failure).
    console.error("signInWithMagicLink failed:", error);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
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
export async function signOut(): Promise<never> {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();

  if (error) {
    // Log detail server-side only; the session cookies are cleared by
    // Supabase's signOut call regardless of this error in practice, but log
    // for visibility rather than silently swallowing it.
    console.error("signOut failed:", error);
  }

  redirect("/sign-in");
}
