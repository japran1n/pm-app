import { notFound, redirect } from "next/navigation";
import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { Button } from "@/components/ui/button";

// Server Component layout (AS-012, AS-013, AS-042, AS-144): resolves the
// active workspace from the URL slug, verifies the caller has an active
// membership, and fetches every active-membership workspace for the
// switcher. Next.js 16: `params` is a Promise and must be awaited.
//
// AS-144: a nonexistent workspace slug and an existing-but-not-a-member
// slug MUST be indistinguishable from the outside — otherwise a
// permission-denied response would itself leak that the workspace exists.
// RLS's `workspaces_select_active_members` policy already collapses both
// cases (plus soft-deleted) to "no row returned" from the query below, so
// both paths call the same `notFound()` — Next's generic 404 — rather than
// a redirect to a "you don't have access" page or `/onboarding`, either of
// which would confirm existence to a non-member.
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
    // AS-144: generic 404, not a redirect to /onboarding or any page that
    // would signal "you don't have access" — see file-header comment.
    notFound();
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
