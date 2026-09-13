// F016 (AS-017): the workspace switcher's own async server component --
// the caller's active-membership workspace list, previously queried in
// the layout body (after its own big `Promise.all`) and awaited before
// the layout could return any JSX. Moved here so the layout no longer
// awaits it at all; the layout wraps this in its own `<Suspense
// fallback={null}>` and passes the resolved node down as AppSidebar's
// `workspaceSwitcherSlot`. Same query, same "always include the active
// workspace even if the race loses" fallback (AS-012/AS-013), same
// `logoUrl` camelCase mapping (F138/AS-243) -- just moved, not changed.
import { getCurrentUser } from "@/lib/auth/current-user";
import { logger } from "@/lib/observability/logger";
import { WorkspaceSwitcher, type SwitcherWorkspace } from "@/components/workspace-switcher";

export async function WorkspaceSwitcherFigure({
  workspaceIds,
  currentWorkspaceId,
  activeWorkspaceFallback,
}: {
  workspaceIds: string[];
  currentWorkspaceId: string;
  activeWorkspaceFallback: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
  };
}) {
  const { supabase } = await getCurrentUser();

  const { data: workspaces, error: workspacesError } = workspaceIds.length
    ? await supabase
        .from("workspaces")
        .select("id, name, slug, logo_url")
        .in("id", workspaceIds)
        .order("name", { ascending: true })
    : { data: [], error: null };

  if (workspacesError) {
    logger.error("WorkspaceSwitcherFigure: failed to look up member workspaces", { error: workspacesError });
  }

  // AS-012/AS-013: the active workspace is guaranteed to be an active
  // membership (the layout already verified that above this component
  // mounts), so it must appear in `workspaces` unless the two queries
  // raced with a concurrent membership change; fall back to including it
  // explicitly so the switcher never omits the current workspace.
  const workspacesWithFallback = (workspaces ?? []).some(
    (w) => w.id === activeWorkspaceFallback.id,
  )
    ? (workspaces ?? [])
    : [...(workspaces ?? []), activeWorkspaceFallback];

  // F138 (AS-243): camelCase `logoUrl` for SwitcherWorkspace's props.
  const switcherWorkspaces: SwitcherWorkspace[] = workspacesWithFallback.map((w) => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    logoUrl: w.logo_url ?? null,
  }));

  return (
    <WorkspaceSwitcher
      workspaces={switcherWorkspaces}
      currentWorkspaceId={currentWorkspaceId}
    />
  );
}
