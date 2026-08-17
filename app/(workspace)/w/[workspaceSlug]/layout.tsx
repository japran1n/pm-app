import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { Button } from "@/components/ui/button";

// Server Component layout (AS-012, AS-013, AS-042): resolves the active
// workspace from the URL slug, verifies the caller has an active
// membership, and fetches every active-membership workspace for the
// switcher. Next.js 16: `params` is a Promise and must be awaited.
//
// Membership/not-found handling here is intentionally minimal. F023 owns
// the real "workspace not found / not a member" experience (dedicated
// not-found UI, distinguishing "doesn't exist" from "you were removed").
// For this feature, an unresolvable slug (workspace doesn't exist, is
// soft-deleted, or the caller isn't an active member — RLS's
// `workspaces_select_active_members` policy collapses all three cases to
// "no row returned", which is exactly the behavior AS-138/AS-139 want) just
// redirects to `/onboarding`, which is a safe landing spot for any
// authenticated user. TODO(F023): replace with a proper not-found page.
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
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

  // RLS (`workspaces_select_active_members`) already scopes this to
  // non-deleted workspaces the caller is an active member of, so a null
  // result here covers "doesn't exist", "soft-deleted", and "not an active
  // member" alike.
  const { data: activeWorkspace, error: activeWorkspaceError } =
    await supabase
      .from("workspaces")
      .select("id, name, slug")
      .eq("slug", workspaceSlug)
      .maybeSingle();

  if (activeWorkspaceError) {
    console.error(
      "WorkspaceLayout: failed to look up workspace by slug:",
      activeWorkspaceError,
    );
  }

  if (!activeWorkspace) {
    // Placeholder for THIS feature only — see F023 TODO above.
    redirect("/onboarding");
  }

  // All of the caller's active memberships, for the switcher list
  // (AS-012). Two-step query rather than an embedded select: the
  // generated `workspace_members` -> `workspaces` FK is not one-to-one, so
  // an embedded select types as an array and cannot be `.slug`-accessed
  // directly (same tradeoff F013's auth callback route made).
  const { data: memberships, error: membershipsError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (membershipsError) {
    console.error(
      "WorkspaceLayout: failed to look up user's memberships:",
      membershipsError,
    );
  }

  const workspaceIds = (memberships ?? []).map((m) => m.workspace_id);

  const { data: workspaces, error: workspacesError } = workspaceIds.length
    ? await supabase
        .from("workspaces")
        .select("id, name, slug")
        .in("id", workspaceIds)
        .order("name", { ascending: true })
    : { data: [], error: null };

  if (workspacesError) {
    console.error(
      "WorkspaceLayout: failed to look up member workspaces:",
      workspacesError,
    );
  }

  // The active workspace is guaranteed to be an active membership (we just
  // verified that above), so it must appear in `workspaces` unless the two
  // queries raced with a concurrent membership change; fall back to
  // including it explicitly so the switcher never omits the current
  // workspace (AS-012/AS-013).
  const switcherWorkspaces = (workspaces ?? []).some(
    (w) => w.id === activeWorkspace.id,
  )
    ? (workspaces ?? [])
    : [...(workspaces ?? []), activeWorkspace];

  return (
    <div className="flex min-h-svh flex-col">
      <header className="flex h-12 items-center gap-3 border-b px-4">
        <WorkspaceSwitcher
          workspaces={switcherWorkspaces}
          currentWorkspaceId={activeWorkspace.id}
        />
        <form action={signOut} className="ml-auto">
          <Button type="submit" variant="ghost" size="sm" className="gap-1.5">
            <LogOut className="size-4" aria-hidden="true" />
            Sign out
          </Button>
        </form>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
