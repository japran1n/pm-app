// Browser Supabase client (Client Components only).
// Uses the new sb_publishable_* key format per tech-decisions.md.

// Env access goes through lib/env.ts's client-safe section (audit
// NX-003) — its getters reference process.env.NEXT_PUBLIC_* literally so
// Next.js still inlines the values into the browser bundle.

import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";

export function createClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
