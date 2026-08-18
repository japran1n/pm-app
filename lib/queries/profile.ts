// F124 (AS-207): resolves the signed-in caller's IANA timezone
// (`profiles.timezone`, F120/F123) ONCE per request, for Server Components
// that need to thread it down as a prop to every overdue/today-aware
// surface (board, list, dashboard) — never queried per card or per row.
// Every page in scope (board/page.tsx, list/page.tsx, the workspace
// dashboard page.tsx) already builds its own `supabase` client via
// `createClient()`; this takes that same client so the call is a single
// extra RLS-scoped read on top of it, not a second client/session.
//
// Falls back to "UTC" — matching F120's own `profiles.timezone` DB default
// and F123's Zod-validated write path — for a caller with no session, or
// a profile row this query couldn't resolve (defensive; every
// authenticated user has a profile row created automatically by F120's
// `on_auth_user_created` trigger, so the fallback path shouldn't normally
// be reachable for a real signed-in user).
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_TIMEZONE = "UTC";

export async function getCurrentUserTimezone(
  supabase: SupabaseClient,
): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return DEFAULT_TIMEZONE;

  const { data: profile } = await supabase
    .from("profiles")
    .select("timezone")
    .eq("id", user.id)
    .maybeSingle();

  return profile?.timezone ?? DEFAULT_TIMEZONE;
}
