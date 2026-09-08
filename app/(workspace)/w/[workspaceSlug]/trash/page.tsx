import { redirect } from "next/navigation";
import { Trash2 } from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceTrash } from "@/lib/queries/trash";
import { TrashFilters } from "@/components/trash/trash-filters";
import { TrashList } from "@/components/trash/trash-list";
import { canPurge as canPurgePredicate } from "@/lib/auth/permissions";
import { logger } from "@/lib/observability/logger";

// F188 (AS-343, AS-347, AS-352): the workspace trash view — every deleted
// task and deleted comment (`deleted_at IS NOT NULL`) visible to the
// caller in the active workspace, newest first, with a type filter.
//
// Access (mirrors F142's archive page pattern exactly, per this feature's
// worker brief): reachable by any active, non-guest member — same gate
// the sidebar entry itself uses (components/nav/app-sidebar.tsx's
// `isGuest` prop). A guest hitting this URL directly is redirected before
// the trash query runs, same "redirect away, not just hide UI" convention
// as the archive/members/audit pages. A guest is scoped to specific
// projects (F134's AS-223) and this is a workspace-wide admin-adjacent
// view of deletions across every project (active or not) in the
// workspace — the same kind of workspace-broad visibility a guest should
// not get, per this feature's own Notes ("A guest should see only their
// own projects' trash — verify against F134's policies"; taking the
// simpler, existing option rather than inventing a guest-scoped variant
// of this page, recorded in this feature's handoff Decisions Made).
//
// AS-352 (workspace + project scope): even for a non-guest member, the
// row-level scoping is NOT re-implemented here — `getWorkspaceTrash`
// (lib/queries/trash.ts) uses the normal RLS-respecting client, and the
// new `tasks_select_trash_visible_members`/`comments_select_trash_
// visible_members` policies reuse `is_project_visible_to`/
// `is_task_visible_to` verbatim, so a private project's deleted rows are
// exactly as invisible to a non-member here as its live rows already are.
//
// Server Component: data loads here and is passed down as props; the
// type filter is the one interactive control, and it lives entirely in
// the URL (searchParams) per this feature's Clarified implementation, so
// this page re-fetches nothing on filter change beyond the already-cheap
// slice of an already-loaded array (no live restore/undo action exists on
// this page — that's F189, out of scope here, see this feature's
// handoff).
export default async function TrashPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceSlug: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { workspaceSlug } = await params;
  const resolvedSearchParams = await searchParams;

  const supabase = await createClient();

  // Perf (W9): auth and the workspace-by-slug lookup are independent of
  // each other.
  const [
    {
      data: { user },
    },
    { data: workspace },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from("workspaces").select("id, name").eq("slug", workspaceSlug).maybeSingle(),
  ]);

  if (!user) {
    redirect("/sign-in");
  }

  // Defensive fallback only — the layout guard above already redirects
  // away when the workspace can't be resolved for this caller.
  if (!workspace) {
    redirect("/onboarding");
  }

  let allItems: Awaited<ReturnType<typeof getWorkspaceTrash>> = [];
  let loadError = false;

  // Perf (W9): the caller's membership role and the trash list both
  // depend only on `workspace.id`/`user.id` (already known), not on each
  // other -- fetched in parallel. The guest redirect below still runs
  // before anything is rendered, so a guest never sees this page's
  // content even though the (cheap, RLS-scoped) trash query already ran
  // alongside the role check.
  const [{ data: ownMembership }, trashResult] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", workspace.id)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle(),
    getWorkspaceTrash(workspace.id).then(
      (items) => ({ items, error: null as unknown }),
      (error) => {
        logger.error("TrashPage: failed to load trash", { error: error });
        return { items: [] as Awaited<ReturnType<typeof getWorkspaceTrash>>, error };
      },
    ),
  ]);

  const role = ownMembership?.role ?? "guest";

  if (role === "guest") {
    redirect(`/w/${workspaceSlug}`);
  }

  allItems = trashResult.items;
  loadError = trashResult.error !== null;

  const typeFilter = resolvedSearchParams.type;
  const items =
    typeFilter === "task" || typeFilter === "comment"
      ? allItems.filter((item) => item.type === typeFilter)
      : allItems;

  const dateFormatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="title-1 font-semibold">Trash</h1>
        <p className="text-mini text-muted-foreground">
          Deleted tasks and comments from {workspace.name}. Deleting hides an
          item from active views without permanently removing its data.
        </p>
      </div>

      <TrashFilters />

      {loadError && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-mini text-destructive"
        >
          <p>Something went wrong loading the trash. Please try again.</p>
          <a href={`/w/${workspaceSlug}/trash`} className="underline">
            Retry
          </a>
        </div>
      )}

      {!loadError && items.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
          <div
            aria-hidden="true"
            className="flex size-12 items-center justify-center rounded-full bg-muted"
          >
            <Trash2 className="size-6 text-muted-foreground" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-mini font-medium">
              {allItems.length === 0 ? "Trash is empty" : "No matching items"}
            </p>
            <p className="text-mini text-muted-foreground">
              {allItems.length === 0
                ? "Tasks and comments you delete will show up here, along with when they were deleted and by whom."
                : "Try a different type filter."}
            </p>
          </div>
        </div>
      )}

      {!loadError && items.length > 0 && (
        <TrashList
          items={items}
          dateFormatter={dateFormatter}
          canPurge={canPurgePredicate({ role })}
        />
      )}
    </div>
  );
}
