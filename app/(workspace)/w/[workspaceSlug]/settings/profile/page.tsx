import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/profile/profile-form";
import { StatusNoteForm } from "@/components/profile/status-note-form";
import { NotificationPreferencesForm } from "@/components/notifications/preferences-form";
import { getNotificationPreferences } from "@/lib/actions/notification-preferences";
import { ReplayTourButton } from "@/components/onboarding/replay-tour-button";
import { logger } from "@/lib/observability/logger";

// F123 (AS-202): the profile settings page — display name, avatar upload
// with live preview, and timezone. Server Component for data loading, per
// the clarified spec's default pattern; the only interactive part is
// <ProfileForm>, a Client Component.
//
// Access: relies on the workspace-membership layout guard above this
// route (app/(workspace)/w/[workspaceSlug]/layout.tsx, same convention as
// the members settings page) — reaching this page at all already means
// the caller is an active member of `workspaceSlug`. No additional
// page-level gate is needed beyond that: unlike the members page, this
// page's content isn't workspace-scoped data at all (a user's profile is
// the same row regardless of which workspace's settings URL they reached
// it through), it just lives under this workspace's settings path per the
// mission's file layout.
export default async function ProfileSettingsPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  // Out-of-office status note: scoped to workspace_members (per-workspace),
  // not the cross-workspace `profiles` row -- see
  // supabase/migrations/20261114020000_workspace_members_status_note.sql.
  // RLS-scoped lookup (workspace_members_select_fellow_members) -- same
  // "reaching this page already means active membership" posture the
  // calendar page's own workspace-by-slug lookup relies on.
  const { data: workspaceRow } = await supabase
    .from("workspaces")
    .select("id")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  let statusNote: string | null = null;
  let statusNoteUntil: string | null = null;
  if (workspaceRow) {
    const { data: memberRow, error: memberError } = await supabase
      .from("workspace_members")
      .select("status_note, status_note_until")
      .eq("workspace_id", workspaceRow.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (memberError) {
      logger.error("ProfileSettingsPage: failed to load status note", { error: memberError });
    } else if (memberRow) {
      // This is the EDIT surface, not a display surface -- the raw saved
      // value is shown/editable here regardless of whether
      // isStatusNoteActive would currently treat it as expired (a member
      // should still see and be able to clear/update their own already-
      // expired note). isStatusNoteActive gates every *display* surface
      // instead (UserAvatar tooltips, getWorkspaceMembers).
      statusNote = memberRow.status_note;
      statusNoteUntil = memberRow.status_note_until;
    }
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, timezone")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    // Real error logging: this repo has no error-tracking SDK wired up
    // yet, matching every other page's existing convention.
    logger.error("ProfileSettingsPage: failed to load profile", { error: error });
  }

  // F120's on_auth_user_created trigger guarantees a profiles row exists
  // for every authenticated user (AS-201) — `timezone` always has its
  // 'UTC' default even before this feature's action ever runs, so this
  // fallback is defensive only (e.g. a transient read error above).
  const timezone = profile?.timezone ?? "UTC";

  // Timezone list source: Intl.supportedValuesOf('timeZone') per this
  // feature's explicit instruction, rather than a hard-coded list that
  // could drift out of sync with the runtime's own IANA tzdata. Computed
  // here (Server Component) and passed down as a typed prop, matching the
  // clarified spec's "server-fetched... passed down as typed props"
  // pattern and avoiding any server/client hydration mismatch a
  // client-computed list could risk.
  //
  // "UTC" is prepended explicitly: `supportedValuesOf("timeZone")` lists
  // canonical CLDR zone names, which includes "Etc/UTC" but NOT the bare
  // string "UTC" — yet "UTC" is exactly what F120's `profiles.timezone`
  // column defaults every row to. Without this, a user who has never
  // touched this field would see the Select render blank (no option
  // matches its own current value) instead of showing "UTC" selected.
  // lib/validation/profile.ts's `isValidTimeZone` accepts "UTC" too (see
  // its own comment for the same gap, checked the same way), so this
  // list and the server-side check agree on what's selectable.
  const timezones = ["UTC", ...Intl.supportedValuesOf("timeZone")];

  // F211 (AS-391, AS-396): notification preferences, loaded server-side
  // and passed down as typed props, same pattern as the profile fields
  // above. getNotificationPreferences already fails open to this
  // feature's documented defaults if the row is somehow missing, so
  // `preferencesResult.ok` is only ever false on a genuine auth/read
  // error (already unreachable here — `user` is confirmed above), not on
  // "no row yet".
  const preferencesResult = await getNotificationPreferences();
  if (!preferencesResult.ok) {
    logger.error("ProfileSettingsPage: failed to load notification preferences", { error: preferencesResult.error });
  }
  const notificationPreferences = preferencesResult.ok
    ? preferencesResult.data
    : {
        mentionInApp: true,
        mentionEmail: true,
        taskAssignedInApp: true,
        taskAssignedEmail: true,
        commentReplyInApp: true,
        commentReplyEmail: false,
        watcherUpdateInApp: true,
        watcherUpdateEmail: false,
        taskDueSoonInApp: true,
        taskDueSoonEmail: false,
        emailEnabled: true,
        chatDmInApp: true,
        chatThreadReplyInApp: true,
        soundEnabled: true,
        soundVolume: 60,
        soundOnlyWhenUnfocused: true,
      };

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="title-1 font-semibold">Profile</h1>
        <p className="text-mini text-muted-foreground">
          Your name, avatar, and timezone as they appear everywhere
          you&rsquo;re shown across the app.
        </p>
      </div>

      <ProfileForm
        userId={user.id}
        email={user.email ?? null}
        displayName={profile?.display_name ?? null}
        avatarUrl={profile?.avatar_url ?? null}
        timezone={timezone}
        timezones={timezones}
      />

      {workspaceRow ? (
        <>
          <div className="flex flex-col gap-1">
            <h2 className="title-1 font-semibold">Status note</h2>
            <p className="text-mini text-muted-foreground">
              Let your teammates know when you&rsquo;re out of office. Shown in a
              tooltip when someone hovers your avatar, until the date you pick
              (or indefinitely if you leave it blank).
            </p>
          </div>

          <StatusNoteForm
            workspaceId={workspaceRow.id}
            statusNote={statusNote}
            statusNoteUntil={statusNoteUntil}
          />
        </>
      ) : null}

      <div className="flex flex-col gap-1">
        <h2 className="title-1 font-semibold">Notifications</h2>
        <p className="text-mini text-muted-foreground">
          Choose which notifications you receive, and how.
        </p>
      </div>

      <NotificationPreferencesForm
        initialPreferences={notificationPreferences}
      />

      {/* F253 (AS-493): replay entry point for the first-run guided
          tour -- this profile page is the closest thing this app has to
          a "profile menu" (no dropdown user menu exists yet). */}
      <div className="flex flex-col gap-1">
        <h2 className="title-1 font-semibold">Onboarding</h2>
        <p className="text-mini text-muted-foreground">
          Replay the guided tour of the sidebar, board, and task creation.
        </p>
        <div>
          <ReplayTourButton />
        </div>
      </div>
    </div>
  );
}
