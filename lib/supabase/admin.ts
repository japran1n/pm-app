// Server-only privileged Supabase client (secret key, bypasses RLS by design).
// AS-140: never imported by Client Components; never exposed to the browser.
// Used only where RLS itself has no policy that permits the operation, e.g.
// F013 bootstrapping the first `workspace_members` owner row (see
// supabase/migrations/20260817222822_rls_workspaces.sql — workspace_members
// has no INSERT policy, by design, until an invite/accept feature adds one).

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { serverEnv } from "@/lib/env";

export function createAdminClient() {
  const env = serverEnv();
  return createSupabaseClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
