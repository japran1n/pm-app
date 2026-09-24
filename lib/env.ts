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
  PORTAL_PREVIEW_MINT_ENABLED: z.string().min(1).optional(),
  // SEC-HTTP-13: both default ON when unset (unchanged behaviour). Parsed
  // explicitly by `parseBooleanFlag` below; see isWorkspaceCreationAllowed /
  // isPasswordLoginEnabled for the call-site helpers.
  ALLOW_WORKSPACE_CREATION: z
    .string()
    .optional()
    .transform((value) => parseBooleanFlag(value, true)),
  PASSWORD_LOGIN_ENABLED: z
    .string()
    .optional()
    .transform((value) => parseBooleanFlag(value, true)),
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
    PORTAL_PREVIEW_MINT_ENABLED: emptyToUndefined(
      process.env.PORTAL_PREVIEW_MINT_ENABLED,
    ),
    ALLOW_WORKSPACE_CREATION: emptyToUndefined(
      process.env.ALLOW_WORKSPACE_CREATION,
    ),
    PASSWORD_LOGIN_ENABLED: emptyToUndefined(process.env.PASSWORD_LOGIN_ENABLED),
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

/**
 * "Preview as client" mints a real Supabase session for the previewed
 * client, so it is off unless PORTAL_PREVIEW_MINT_ENABLED is exactly
 * "true". Reads process.env directly (not `serverEnv()`) so checking the
 * flag can never throw over an unrelated missing variable. Server-only.
 */
export function isPortalPreviewMintEnabled(): boolean {
  return process.env.PORTAL_PREVIEW_MINT_ENABLED === "true";
}

/**
 * Explicit on/off parsing for boolean feature flags (SEC-HTTP-13).
 * "true"/"1"/"yes"/"on" -> true, "false"/"0"/"no"/"off" -> false (trimmed,
 * case-insensitive). Unset or empty -> `defaultValue`. An unrecognised value
 * also falls back to `defaultValue` rather than throwing, so a typo can never
 * take the whole server down — but it is never silently read as the
 * opposite of what the default says.
 */
export function parseBooleanFlag(
  value: string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return defaultValue;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

/**
 * Whether any signed-in user may create a new workspace. Default ON when
 * ALLOW_WORKSPACE_CREATION is unset. Reads process.env directly (not
 * `serverEnv()`) so the check can never throw over an unrelated missing
 * variable. Server-only.
 */
export function isWorkspaceCreationAllowed(): boolean {
  return parseBooleanFlag(process.env.ALLOW_WORKSPACE_CREATION, true);
}

/**
 * Whether the email/username + password sign-in path is open. Default ON
 * when PASSWORD_LOGIN_ENABLED is unset. Server-only.
 */
export function isPasswordLoginEnabled(): boolean {
  return parseBooleanFlag(process.env.PASSWORD_LOGIN_ENABLED, true);
}

/**
 * GAP5-09: the absolute origin (no trailing slash) used to build every URL
 * that leaves the server — magic-link and invite `redirectTo` values in
 * particular. Never derived from the request's `Origin`/`Host` headers,
 * which a caller controls.
 *
 * Resolution order: NEXT_PUBLIC_APP_URL; then the platform-provided Vercel
 * URL (set by the host, not the request); then http://localhost:3000 in
 * development/test. Throws in any other environment when nothing is
 * configured, so a missing setting fails loudly instead of emailing links
 * that point somewhere unexpected. Server-only.
 */
export function appUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.VERCEL_ENV === "production" &&
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return url.origin;
      }
    } catch {
      // fall through to the next candidate
    }
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  throw new Error(
    "Missing or invalid environment variable: NEXT_PUBLIC_APP_URL. " +
      "Set it to the app's absolute origin (see .env.example).",
  );
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
