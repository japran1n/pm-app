import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "@/components/profile/profile-form";

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
export default async function ProfileSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name, avatar_url, timezone")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    // Real error logging: this repo has no error-tracking SDK wired up
    // yet, matching every other page's existing convention.
    console.error("ProfileSettingsPage: failed to load profile:", error);
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

  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Profile</h1>
        <p className="text-sm text-muted-foreground">
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
    </div>
  );
}
