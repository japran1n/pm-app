import { z } from "zod";

// Validates sign-in-with-magic-link input before it ever reaches Supabase
// Auth (AS-146). Kept intentionally small: Supabase Auth itself owns the
// magic-link throttling (AS-145) — this schema only guards shape/format.
export const signInSchema = z.object({
  email: z
    .string()
    .trim()
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
