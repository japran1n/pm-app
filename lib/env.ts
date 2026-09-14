// Centralized, validated access to environment variables (audit NX-003).
//
// Two sections, deliberately separate:
//
// 1. `serverEnv()` — server-only. Parses `process.env` lazily with zod on
//    first access and caches the result. A missing/empty required var
//    throws immediately with a message naming exactly which variable is
//    missing, instead of the old pattern of `process.env.X!` producing an
//    opaque "fetch failed" or "Invalid URL" deep inside a Supabase call.
//    Never import this from a Client Component — it reads server secrets.
//
// 2. `clientEnv` — safe in the browser. Next.js statically inlines
//    `process.env.NEXT_PUBLIC_*` expressions at build time, but ONLY when
//    they are written out literally (`process.env.NEXT_PUBLIC_X`), never
//    via dynamic lookup — so this section references each var literally
//    inside a lazy getter. Getters (rather than eager consts) keep the
//    "throw a clear message on first access" behavior without breaking
//    module import in environments where a var is legitimately absent.
//
// Migration status: consumed by lib/supabase/{admin,server,client}.ts and
// the three app/api/extension/* routes. Other `process.env` consumers are
// intentionally left for a later pass.

import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string({ error: "NEXT_PUBLIC_SUPABASE_URL is required" })
    .min(1, "NEXT_PUBLIC_SUPABASE_URL is required"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string({ error: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required" })
    .min(1, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required"),
  SUPABASE_SECRET_KEY: z
    .string({ error: "SUPABASE_SECRET_KEY is required" })
    .min(1, "SUPABASE_SECRET_KEY is required"),
  // Optional: features degrade (loudly, per NX-003) when these are unset.
  EXTENSION_ID: z.string().min(1).optional(),
  EXTENSION_HANDOFF_SECRET: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().min(1).optional(),
  ALLOW_USERNAME_LOGIN: z.string().min(1).optional(),
  DEV_LOGIN_ENABLED: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedServerEnv: ServerEnv | null = null;

/**
 * Validated server-side environment. Parses lazily on first call, caches
 * on success, and throws a clear error naming every missing variable.
 */
export function serverEnv(): ServerEnv {
  if (cachedServerEnv) return cachedServerEnv;

  const result = serverEnvSchema.safeParse({
    // Literal references so Next.js can inline the NEXT_PUBLIC_* ones in
    // any bundle this happens to reach; the rest are server-only anyway.
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    EXTENSION_ID: emptyToUndefined(process.env.EXTENSION_ID),
    EXTENSION_HANDOFF_SECRET: emptyToUndefined(
      process.env.EXTENSION_HANDOFF_SECRET,
    ),
    NEXT_PUBLIC_APP_URL: emptyToUndefined(process.env.NEXT_PUBLIC_APP_URL),
    ALLOW_USERNAME_LOGIN: emptyToUndefined(process.env.ALLOW_USERNAME_LOGIN),
    DEV_LOGIN_ENABLED: emptyToUndefined(process.env.DEV_LOGIN_ENABLED),
  });

  if (!result.success) {
    const missing = result.error.issues
      .map((issue) => issue.path.join(".") || "(root)")
      .join(", ");
    throw new Error(
      `Missing or invalid environment variable(s): ${missing}. ` +
        `Set them in .env (see .env.example).`,
    );
  }

  cachedServerEnv = result.data;
  return cachedServerEnv;
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

function requireClientVar(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. ` +
        `Set it in .env (see .env.example) and rebuild — NEXT_PUBLIC_* ` +
        `values are inlined into the client bundle at build time.`,
    );
  }
  return value;
}

/**
 * Browser-safe environment. Each getter references its
 * `process.env.NEXT_PUBLIC_*` variable LITERALLY so Next.js can inline it
 * into the client bundle; access is lazy so a missing var throws a clear
 * message at first use rather than at module import.
 */
export const clientEnv = {
  get NEXT_PUBLIC_SUPABASE_URL(): string {
    return requireClientVar(
      "NEXT_PUBLIC_SUPABASE_URL",
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
  },
  get NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY(): string {
    return requireClientVar(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  get NEXT_PUBLIC_APP_URL(): string | undefined {
    return process.env.NEXT_PUBLIC_APP_URL || undefined;
  },
};
