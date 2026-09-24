import { z } from "zod";

// Validates sign-in-with-magic-link input before it ever reaches Supabase
// Auth (AS-146). Kept intentionally small: Supabase Auth itself owns the
// magic-link throttling (AS-145) — this schema only guards shape/format.
export const signInSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Email is required.")
    .email("Enter a valid email address."),
});

export type SignInInput = z.infer<typeof signInSchema>;

// F-DEV: password sign-in input. `identifier` accepts either an email
// address or a username — resolution of a username to its account email
// happens server-side (lib/actions/auth.ts), so this schema only guards
// shape. Password minimum matches Supabase Auth's own default (6).
export const passwordSignInSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Enter your email or username."),
  password: z.string().min(6, "Password must be at least 6 characters."),
});

export type PasswordSignInInput = z.infer<typeof passwordSignInSchema>;

// GAP5-09: a post-auth `next`/`redirect` param may only ever be a
// same-origin, root-relative path. Returns the normalised path (pathname +
// search + hash) or null when the value is missing or unsafe:
// protocol-relative (`//evil.com`), backslash tricks (`/\\evil.com`, which
// browsers treat as `//`), any scheme (`https:`, `javascript:`), control
// characters, or anything that resolves off-origin once parsed.
const NEXT_PATH_BASE = "http://next-path.invalid";

export function safeNextPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) {
    return null;
  }
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  if (raw.includes("\\")) return null;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;

  let parsed: URL;
  try {
    parsed = new URL(raw, NEXT_PATH_BASE);
  } catch {
    return null;
  }
  if (parsed.origin !== NEXT_PATH_BASE) return null;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

// GAP5-06: the email OTP types /auth/confirm accepts (Supabase's
// server-side `verifyOtp({ token_hash, type })` flow). Recovery and
// email-change are deliberately excluded: this app has no UI for either.
export const confirmOtpTypeSchema = z.enum([
  "invite",
  "magiclink",
  "email",
  "signup",
]);

export type ConfirmOtpType = z.infer<typeof confirmOtpTypeSchema>;

// Invite accept/decline input — the invite row id only. Which email the
// invite must match is always read from the verified session, never from
// the form.
export const inviteResponseSchema = z.object({
  inviteId: z.string().uuid("Invalid invite."),
});
