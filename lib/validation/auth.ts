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
