"use server";
import { logger } from "@/lib/observability/logger";


// F253 (AS-491, AS-492, AS-493): the signed-in user's first-run guided
// tour state. `profiles.tour_completed_at` is the single source of truth
// (see this feature's migration's own header comment for why this reuses
// `profiles` rather than a new table) — NULL means "never dismissed,
// offer the tour" (AS-491), a timestamp means "dismissed, don't reappear"
// (AS-492), and setting it back to NULL is how a replay (AS-493) works.
//
// Pattern mirrors lib/actions/notification-preferences.ts and
// lib/actions/board-prefs.ts: the caller's own session client (RLS's
// existing `profiles_update_self` policy is self-scoped — no admin
// client or SECURITY DEFINER RPC needed for a user writing their own
// row), generic user-facing errors with details only logged server-side.

import { getCurrentUser } from "@/lib/auth/current-user";
import type { ActionOutcome } from "@/lib/actions/authz";

export type GetTourStatusResult = ActionOutcome<{ dismissed: boolean }>;

// Server Component data-loading half (the clarified spec's "server-fetched
// in the page/layout... passed down as typed props" pattern) — the
// workspace layout calls this once and passes the boolean down, rather
// than the client tour component querying Supabase directly on mount.
export async function getTourStatus(): Promise<GetTourStatusResult> {
  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("tour_completed_at")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    logger.error("getTourStatus: read failed", { error: error });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  // No row is unreachable in practice (F120's on_auth_user_created
  // trigger guarantees a profiles row for every authenticated user), but
  // treated the same as "never dismissed" defensively rather than
  // surfacing an error for a row the user has every right to see.
  return { ok: true, dismissed: Boolean(data?.tour_completed_at) };
}

export type SetTourStatusResult = ActionOutcome;

// AS-492: called on dismiss/step-through-completion. Persists per user
// (not per browser/localStorage), so it does not reappear after a reload
// or in a new tab/device.
export async function dismissTour(): Promise<SetTourStatusResult> {
  return writeTourCompletedAt(new Date().toISOString());
}

// AS-493: replay from the profile menu resets the persisted flag so the
// tour is offered again; the tour component itself decides to actually
// start playing when it next mounts and reads `dismissed: false`.
export async function replayTour(): Promise<SetTourStatusResult> {
  return writeTourCompletedAt(null);
}

async function writeTourCompletedAt(
  value: string | null,
): Promise<SetTourStatusResult> {
  const { supabase, user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in." };
  }

  // `.eq("id", user.id)` is defence-in-depth on top of RLS's
  // `profiles_update_self` policy (id = auth.uid()), same "DB is the
  // last line, not the only line" convention as this codebase's other
  // per-user preference actions.
  const { error } = await supabase
    .from("profiles")
    .update({ tour_completed_at: value })
    .eq("id", user.id);

  if (error) {
    logger.error("writeTourCompletedAt: write failed", { error: error });
    return { ok: false, error: "Something went wrong. Please try again in a moment." };
  }

  return { ok: true };
}
