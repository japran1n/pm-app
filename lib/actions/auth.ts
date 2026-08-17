"use server";

import { headers } from "next/headers";

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
