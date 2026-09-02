// F023 (AS-021, AS-022, AS-023, AS-024): shared auth-hydration guard for
// every synchronous Realtime subscriber in the portal. F012 diagnosed and
// fixed a real race in `usePortalOverviewRealtime` alone: on a fresh page
// load, `createClient()`'s underlying Realtime socket starts with
// `accessTokenValue === null` (unauthenticated) and only adopts the real
// session's JWT once `@supabase/ssr`'s async cookie hydration completes.
// A channel created and `.subscribe()`d before that resolves joins
// unauthenticated -- it still reports "Subscribed to PostgreSQL" (so this
// fails silently), receives every table-wide DELETE (Realtime does not
// apply RLS to DELETE payloads) but is filtered out of every RLS-gated
// INSERT/UPDATE. Scrutiny found this fix applied at exactly one of the
// portal's subscribers; this module hoists it so every subscriber gets the
// same treatment instead of a second hand-rolled copy of the race fix.
//
// Also closes the regression scrutiny found in the original: an unmount
// that happens BEFORE `getSession()`/`setAuth()` resolves must never let
// the deferred `subscribe()` call run afterwards (a leaked channel that
// never gets torn down), and a rejected `getSession()`/`setAuth()` must
// never surface as an unhandled promise rejection.
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Awaits the current session, hands its JWT to `realtime.setAuth()`, and
 * only then calls `subscribe(supabase)` to create and join the channel --
 * so the very first `phx_join` this caller ever sends already carries the
 * real, authenticated `access_token`, no unauthenticated-join race.
 *
 * Returns a synchronous `release()` function, safe to call from an effect
 * cleanup at any time -- including before the session promise has
 * resolved, in which case the deferred `subscribe()` call is skipped
 * entirely (nothing is ever created, so there is nothing to release).
 *
 * A rejected `getSession()`/`setAuth()` call is swallowed rather than left
 * as an unhandled rejection; this mount simply never subscribes.
 */
export function subscribeWhenAuthenticated(
  supabase: SupabaseClient,
  subscribe: (supabase: SupabaseClient) => () => void,
): () => void {
  let cancelled = false;
  let release: (() => void) | null = null;

  supabase.auth
    .getSession()
    .then(({ data }) => {
      if (cancelled) return;
      const accessToken = data.session?.access_token;
      const afterAuth = accessToken
        ? supabase.realtime.setAuth(accessToken)
        : Promise.resolve();
      return afterAuth.then(() => {
        if (cancelled) return;
        release = subscribe(supabase);
      });
    })
    .catch(() => {
      // Hydration failed (e.g. `getSession()` rejected). Never subscribe
      // unauthenticated as a fallback -- just leave this mount with no
      // live channel, and never let the rejection go unhandled.
    });

  return () => {
    cancelled = true;
    release?.();
  };
}
