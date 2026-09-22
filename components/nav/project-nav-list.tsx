"use client";

// F262 (AS-509, AS-511, AS-512, AS-513): the sidebar's own "Projects"
// section — server-fetched by app/(workspace)/w/[workspaceSlug]/layout.tsx
// (same "server-fetched in the layout, passed down as typed props"
// convention every other sidebar-fed value already follows — see that
// layout's own comments) and reusing the exact same RLS-backed,
// guest-scoped query the /projects page already calls
// (lib/queries/projects.ts's getWorkspaceProjects — F134/F132's visibility
// rules apply for free, no second copy of that rule here).
//
// Client Component only because it needs `usePathname()` for AS-511's
// "current project highlighted" and local expand/collapse state — the data
// itself is a prop, never fetched here.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, GripVertical } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { cn } from "@/lib/utils";
import { colorForProjectId } from "@/lib/nav/project-color";
import { readRecentProjectIds } from "@/lib/nav/recent-projects";
import { selectSidebarProjects } from "@/lib/nav/select-sidebar-projects";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { ProjectFavoriteButton } from "@/components/project-favorite-button";
import { reorderProject } from "@/lib/actions/projects";
import { useMembership } from "@/components/auth/membership-provider";
import { canWrite } from "@/lib/auth/permissions";

export type SidebarProjectItem = {
  id: string;
  name: string;
  key: string | null;
  // Feature request "Project ikonica/emoji": optional so every pre-existing
  // caller/test that builds a SidebarProjectItem without this field keeps
  // compiling and falls back to the key/folder-icon treatment below.
  icon?: string | null;
  // F263 (AS-510): whether the SIGNED-IN caller has favourited this
  // project -- server-fetched once alongside the rest of this list
  // (app/(workspace)/w/[workspaceSlug]/layout.tsx's getFavoriteProjectIds
  // call), never a second per-row fetch, per the clarified "no N+1 per
  // row" performance budget. Optional (defaults to false when read below)
  // so every pre-F263 test/caller that builds a SidebarProjectItem without
  // this field keeps compiling and rendering unfavourited, same
  // backward-compatible default convention this file's other optional
  // props already follow.
  isFavorite?: boolean;
  // F011 (SB-043): batched, single-query open-task count from
  // getWorkspaceProjects (lib/queries/projects.ts) -- `null`/`undefined`
  // means "not available" (renders no count, same as 0) rather than a
  // fake 0, per that query's own truthful-`null` convention. Optional so
  // every pre-F011 test/caller keeps compiling.
  openTaskCount?: number | null;
};

export function ProjectNavList({
  workspaceSlug,
  workspaceId,
  projects,
  onNavigate,
}: {
  workspaceSlug: string;
  workspaceId: string;
  projects: SidebarProjectItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(true);
  const membership = useMembership();
  // F046 (M3 scrutiny attempt 2, FU-19): no `MembershipProvider` in the
  // tree now defaults to `false`, not `true` -- a mutation-capable control
  // (drag-and-drop reorder persists to `projects.sidebar_position` via a
  // Server Action) is exactly the case the rest of this codebase's
  // fail-closed convention exists for (AS-231's "never a control that will
  // fail" — see this file's own `canReorder && ...` gate on the drag
  // handle below). An absent provider means the caller's role is
  // genuinely unknown, so the safe default is "can't drag" rather than
  // "can", matching every other write-affordance's fail-closed default in
  // this app (as opposed to a purely read-only default like `hasClient`,
  // which stays permissive because showing/hiding a read-only control
  // carries no such risk).
  const canReorder = membership ? canWrite({ role: membership.role }) : false;

  // F263 (AS-510): local, optimistic mirror of each project's favourite
  // status -- re-synced whenever the SET of project ids changes (a
  // navigation/refetch), same "adjust state during render on prop change"
  // convention this file's sibling components (Watchers, TagsEditor)
  // already use. Re-sorting the pinned group only happens once
  // ProjectFavoriteButton's onChange fires with the CONFIRMED server
  // result (see that component's own header comment), not while a toggle
  // is still pending, so a row doesn't jump groups mid-optimistic-flight.
  const projectIdsKey = projects.map((p) => p.id).join(",");
  const [syncedProjectIdsKey, setSyncedProjectIdsKey] = useState(projectIdsKey);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    () => new Set(projects.filter((p) => p.isFavorite).map((p) => p.id)),
  );

  // Drag-and-drop sidebar reorder: local, optimistic mirror of the
  // WORKSPACE-GLOBAL project order (`projects.sidebar_position` — see
  // supabase/migrations/20261111010000_projects_sidebar_position.sql and
  // lib/actions/projects.ts's `reorderProject`), re-synced on the exact
  // same "the underlying SET of project ids changed" condition as
  // `favoriteIds` above, for the same reason: a real navigation/refetch
  // should always win over a stale local drag, but a toggle elsewhere in
  // this same render pass (e.g. favouriting) must not stomp an
  // in-flight reorder.
  const [orderedIds, setOrderedIds] = useState<string[]>(() =>
    projects.map((p) => p.id),
  );

  // F011/F042 (SB-042, M3 scrutiny FU-4): recently-visited project ids.
  // MUST start as `[]` (not read via a `useState` lazy initializer) so the
  // server render and the FIRST client render agree -- localStorage isn't
  // available during SSR, so a lazy initializer that reads it produces
  // markup that only ever matches the client, and reading it during the
  // client's first render (before hydration reconciles) is exactly the
  // "server and client render disagree" hydration mismatch React warns
  // about. Reading it in a post-mount effect instead means the FIRST
  // client render still matches the server's `[]`-recents markup one-for-
  // one; the (correct) recency-based content then appears in a second,
  // post-hydration render, which is fine -- this is a client-only
  // convenience fallback, not data that needs to be correct before paint.
  const [recentIds, setRecentIds] = useState<string[]>([]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- post-hydration read of persisted UI state
    setRecentIds(readRecentProjectIds());
  }, []);

  if (projectIdsKey !== syncedProjectIdsKey) {
    setSyncedProjectIdsKey(projectIdsKey);
    setFavoriteIds(new Set(projects.filter((p) => p.isFavorite).map((p) => p.id)));
    setOrderedIds(projects.map((p) => p.id));
  }

  const projectsById = new Map(projects.map((p) => [p.id, p]));
  const orderedProjects = orderedIds
    .map((id) => projectsById.get(id))
    .filter((p): p is SidebarProjectItem => Boolean(p));

  function handleFavoriteChange(projectId: string, nextIsFavorite: boolean) {
    setFavoriteIds((previous) => {
      const next = new Set(previous);
      if (nextIsFavorite) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }
      return next;
    });
  }

  // AS-510: favourited projects render pinned in their own group ABOVE the
  // rest of the list, ordered alphabetically within that group (manual
  // ordering explicitly out of scope per the clarification). The
  // non-favourite group keeps this list's existing order (most-recently-
  // created first, per getWorkspaceProjects) -- favouriting a project only
  // changes WHERE it renders, not the relative order of everything else.
  const allFavoriteProjects = orderedProjects
    .filter((project) => favoriteIds.has(project.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  // F011 (SB-041): the pinned favourites group is capped at 5 via
  // `selectSidebarProjects` (lib/nav/select-sidebar-projects.ts).
  const favoriteProjects = selectSidebarProjects(
    allFavoriteProjects,
    [],
    allFavoriteProjects,
  );
  // F041 (M3 scrutiny FU-3, SB-041): only the first 5 (alphabetically)
  // favourites get the pinned/favourite visual treatment above -- anything
  // past that cap must NOT be discarded from the sidebar entirely. Those
  // overflow favourites fall back into the ordinary non-favourite group
  // below (still reachable, still draggable, just without the pinned
  // styling), rather than `allOtherProjects`'s previous "filter out every
  // favourite id" which silently dropped them once there were more than 5.
  const pinnedFavoriteIds = new Set(favoriteProjects.map((p) => p.id));
  // The non-favourite (+ overflow-favourite) group IS drag-reorderable
  // (this feature) — its order is `orderedIds` (the local, optimistic
  // mirror of `sidebar_position`), not the raw prop order, so a completed
  // drag renders in its new position immediately, before the server round
  // trip resolves.
  const allOtherProjects = orderedProjects.filter(
    (project) => !pinnedFavoriteIds.has(project.id),
  );
  // F040 (M3 scrutiny FU-2, SB-042): the no-favourites case now actually
  // wires `selectSidebarProjects` into the render path -- the section
  // shows at most 5 recently-visited projects (still reachable, in full,
  // via the "All projects" link (SB-044) below), rather than the earlier
  // "sort the complete list by recency but never truncate it" compromise.
  // `hasRecentMatch` is computed independently of `selectSidebarProjects`'s
  // own "degrade to `visible.slice(0, 5)`" fallback (that fallback is a
  // property of the pure helper, still correct and still covered by its
  // own unit tests in tests/unit/select-sidebar-projects.test.ts) so this
  // render path can tell "0 favourites, >=1 matching recent" apart from
  // "0 favourites, 0 recognised recent visits" and render the latter as
  // this section's own empty state instead of an unrelated slice of the
  // full project list.
  const SIDEBAR_PROJECTS_LIMIT = 5;
  const otherProjectsById = new Map(allOtherProjects.map((p) => [p.id, p]));
  const hasRecentMatch = recentIds.some((id) => otherProjectsById.has(id));
  const noFavourites = favoriteProjects.length === 0;
  // "True empty" only kicks in once there's actually something to
  // truncate: with no favourites, no matched recents, and MORE projects
  // than the cap, showing an arbitrary (non-recent, non-favourite) slice
  // of the full list is exactly the misleading fallback FU-2 flags --
  // this section's own empty state (every project still one click away
  // via the "All projects" link, SB-044) is more honest than that. When
  // the caller has `limit` or fewer projects there's no truncation
  // happening at all, so showing them plainly (same as before this
  // feature) isn't misleading and stays unchanged.
  // F045 (M3 scrutiny attempt 2, FU-18): the previous
  // `allOtherProjects.length > SIDEBAR_PROJECTS_LIMIT` conjunct here was an
  // untested threshold that appears nowhere in SB-042's own text ("with 0
  // favorites, up to 5 recently visited; with none, an empty state") -- it
  // gated the empty state on how many OTHER projects existed, so a
  // workspace with 0 favourites, 0 recognised recents, and (say) 3
  // projects rendered those 3 projects plainly instead of the empty state
  // SB-042 describes. Showing the existing (<=5) projects was never the
  // intended fallback: the empty state exists precisely so recency (not
  // incidental list order) decides what appears here. Dropped so 0
  // favourites + 0 recents always yields the empty state, at every
  // project count (0/3/5/6+, all pinned by tests below).
  const isTrueEmptyRecents = noFavourites && !hasRecentMatch;
  // F044 (M3 scrutiny attempt 2, FU-17): the section's TOTAL row count
  // (pinned favourites + everything below) must never exceed
  // `SIDEBAR_PROJECTS_LIMIT`, not just the pinned favourites group on its
  // own. Before this fix, whenever >=1 favourite existed the branch below
  // fell through to the unbounded `allOtherProjects`, so the "<=5 digest
  // plus an All projects link" design only ever applied to brand-new
  // accounts with 0 favourites. `favoriteProjects` above is already capped
  // to `SIDEBAR_PROJECTS_LIMIT` by `selectSidebarProjects`, so the budget
  // left for the rest of the section is simply the remainder.
  //
  // Read against SB-041's actual text ("the sidebar Projects section lists
  // up to 5 favorited projects") -- it says nothing about the OTHER rows
  // in the section, so capping the section's total at the same limit is a
  // reading the existing assertion already permits; this does not require
  // (and must not add) a superseding assertion. This does supersede F041's
  // "6th+ favourite spills into the non-pinned group and is guaranteed
  // visible" behaviour: a favourite beyond the pinned cap is no longer
  // guaranteed a row once the section's total budget is exhausted -- it's
  // still one click away via the "All projects" link (SB-044), same as any
  // other overflow project.
  const remainingSlots = Math.max(
    0,
    SIDEBAR_PROJECTS_LIMIT - favoriteProjects.length,
  );
  // Within that remaining budget: recently-visited projects first (still
  // useful context even when favourites exist), then the rest of
  // `allOtherProjects` in its existing (sidebar_position) order, per FU-17's
  // "pinned favourites first, then recents, then remaining projects,
  // truncating the combined list" ordering.
  function selectRemainingOthers(
    pool: SidebarProjectItem[],
    limit: number,
  ): SidebarProjectItem[] {
    if (limit <= 0) return [];
    const byId = new Map(pool.map((p) => [p.id, p]));
    const recentMatches = recentIds
      .map((id) => byId.get(id))
      .filter((p): p is SidebarProjectItem => Boolean(p));
    const recentIdSet = new Set(recentMatches.map((p) => p.id));
    const rest = pool.filter((p) => !recentIdSet.has(p.id));
    return [...recentMatches, ...rest].slice(0, limit);
  }
  // F045: `isTrueEmptyRecents` is now exactly `noFavourites &&
  // !hasRecentMatch` (see its own comment above), so the branch below is
  // simply "0 favourites, >=1 matching recent -> recency-ranked slice" vs.
  // "0 favourites, 0 matching recents -> nothing" (rendered as the empty
  // state, not this list, further down) -- no separate length-gated
  // fallback slice of `allOtherProjects` remains.
  const otherProjects = noFavourites
    ? hasRecentMatch
      ? selectSidebarProjects([], recentIds, allOtherProjects, SIDEBAR_PROJECTS_LIMIT)
      : []
    : selectRemainingOthers(allOtherProjects, remainingSlots);

  // dnd-kit setup, same PointerSensor+KeyboardSensor pairing as the board
  // (components/board/board.tsx) for consistency — see that file's own
  // header comment for why both sensors are required, not optional.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // F042 (M3 scrutiny FU-4): computed from `allOtherProjects` (the full
    // `sidebar_position`-ordered non-favourite group), NOT `otherProjects`
    // (which may be a recency-sorted/truncated VIEW of that group in the
    // no-favourites-yet state -- see `otherProjects`'s own comment above).
    // Dragging is only ever rendered against the sortable list actually on
    // screen (`otherProjects`), but persisting against that view's own
    // index order would compute a `newPosition` relative to a recency
    // ordering the server has never heard of, landing the project
    // somewhere other than the position the user visually dropped it into
    // once `allOtherProjects`'s real order re-asserts itself. Using
    // `allOtherProjects` here means `newPosition` is always relative to the
    // same order the server persists and the next render will show.
    const otherIds = allOtherProjects.map((p) => p.id);
    const oldIndex = otherIds.indexOf(String(active.id));
    const newIndex = otherIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const nextOtherIds = arrayMove(otherIds, oldIndex, newIndex);

    // Rebuild the full workspace order: favourites keep their existing
    // slot in `orderedIds` (dragging only ever happens within the
    // non-favourite group), the non-favourite slots are replaced in
    // place with the freshly reordered sequence above.
    let cursor = 0;
    const nextOrderedIds = orderedIds.map((id) =>
      favoriteIds.has(id) ? id : nextOtherIds[cursor++],
    );

    const previousOrderedIds = orderedIds;
    setOrderedIds(nextOrderedIds);

    // The dragged project's index in the REBUILT full order is exactly
    // the `newPosition` `reorderProject` expects — see that action's own
    // comment for why (removing the target then reinserting it at index
    // `i` into the remaining n-1 siblings puts it at index `i` in the
    // resulting n-length order, which is precisely
    // `nextOrderedIds.indexOf(...)` here).
    const newPosition = nextOrderedIds.indexOf(String(active.id));

    reorderProject(String(active.id), newPosition)
      .then((result) => {
        if (!result.ok) {
          toast.error(result.error);
          setOrderedIds(previousOrderedIds);
        }
      })
      .catch(() => {
        // F046 (M3 scrutiny attempt 2, FU-19): the Server Action itself
        // rejecting (network error, thrown exception rather than a
        // returned `{ ok: false }`) previously had no `.catch` at all --
        // an unhandled promise rejection that ALSO left `orderedIds`
        // permanently pointing at the optimistic (never-persisted) order,
        // silently out of sync with the server forever. Same rollback +
        // generic toast fallback as account-menu.tsx's F021/F024b
        // sign-out `catch` block.
        toast.error("Couldn't reorder this project. Please try again.");
        setOrderedIds(previousOrderedIds);
      });
  }

  function renderProjectRow(
    project: SidebarProjectItem,
    dragHandleProps?: {
      attributes: ReturnType<typeof useSortable>["attributes"];
      listeners: ReturnType<typeof useSortable>["listeners"];
    },
  ) {
    const href = `/w/${workspaceSlug}/projects/${project.id}/list`;
    const isActive =
      pathname === href ||
      pathname.startsWith(`/w/${workspaceSlug}/projects/${project.id}/`);

    const content = (
      <>
        {dragHandleProps && canReorder && (
          // Sidebar drag-and-drop reorder: a dedicated handle rather than
          // making the whole row draggable — the row is a `Link` (its own
          // click target for navigation), and dnd-kit's listeners on the
          // full row would otherwise compete with that click, same
          // reasoning `sortable-task-card.tsx` documents for its own
          // handle-vs-click tradeoffs. Hidden until hover/focus like the
          // favourite button beside it, and gated to `canReorder` so a
          // viewer/guest never sees an affordance for a mutation the
          // server would reject anyway (AS-231's "never a control that
          // will fail" convention).
          <button
            type="button"
            aria-label={`Reorder ${project.name}`}
            className="shrink-0 cursor-grab touch-none text-sidebar-foreground/30 opacity-0 hover:text-sidebar-foreground/70 focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
            onClick={(event) => event.preventDefault()}
            {...dragHandleProps.attributes}
            {...dragHandleProps.listeners}
          >
            <GripVertical className="size-3.5" aria-hidden="true" />
          </button>
        )}
        {/* F011 (SB-043): the colour dot re-added -- deterministic per
            project id (lib/nav/project-color.ts), not stored, not
            hand-written hex. This palette is the exact set
            tests/unit/project-nav-dot-contrast.test.ts already pins as
            clearing 3:1 against both the sidebar's resting and
            hover/active surfaces. */}
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            colorForProjectId(project.id),
          )}
        />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        {/* F011 (SB-043): open-task count in mono, hidden entirely when
            0/null/undefined -- "data is mono" (dates, counts, ids, ...)
            per the Supabase DS typography rules; a 0 count renders
            nothing rather than a visible "0", matching the same
            hide-when-zero convention the primary nav's own numeric
            badges already use (see this file's renderProjectRow
            neighbour, app-sidebar.tsx's badge comment). */}
        {Boolean(project.openTaskCount) && (
          <span className="shrink-0 font-mono text-xs text-sidebar-foreground/50 tabular-nums">
            {project.openTaskCount}
          </span>
        )}
        <ProjectFavoriteButton
          projectId={project.id}
          projectName={project.name}
          isFavorite={favoriteIds.has(project.id)}
          onChange={(nextIsFavorite) =>
            handleFavoriteChange(project.id, nextIsFavorite)
          }
          size="icon"
          // F332 (M17 scrutiny BLOCKER-1 / AS-518): `max-md:size-11` --
          // ProjectFavoriteButton appends this className after its own
          // `size === "icon" ? "size-7" : ...` base via cn(), so this wins
          // on mobile widths only, matching the same breakpoint convention
          // used elsewhere in this file/app-sidebar.tsx for the F265 bump.
          className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100 aria-[pressed=true]:opacity-100 max-md:size-11"
        />
      </>
    );

    return (
      <Link
        key={project.id}
        href={href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          // F332 (M17 scrutiny BLOCKER-1 / AS-518): `max-md:min-h-11` --
          // same breakpoint convention as the primary nav Links in
          // app-sidebar.tsx (this row renders inside the same `md:hidden`
          // mobile Sheet), bumping this row to the 44px touch-target
          // minimum on mobile without affecting its desktop sizing.
          "group flex items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-sm transition-colors md:h-8 md:py-0 max-md:min-h-11",
          isActive
            ? "bg-accent text-foreground font-medium"
            : "text-muted-foreground hover:bg-accent",
        )}
      >
        {content}
      </Link>
    );
  }

  // dnd-kit sortable wrapper for a single non-favourite row -- mirrors
  // `components/board/sortable-task-card.tsx`'s pattern (useSortable +
  // CSS.Transform.toString for the drag transform), except only the
  // handle itself carries the drag listeners (see `renderProjectRow`'s
  // own comment on why the whole row can't).
  function SortableProjectRow({ project }: { project: SidebarProjectItem }) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
      useSortable({ id: project.id, disabled: !canReorder });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    return (
      <div ref={setNodeRef} style={style}>
        {renderProjectRow(project, { attributes, listeners })}
      </div>
    );
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      // AS-512/F119 (AS-069): this section owns its own bounded,
      // internally-scrolling area rather than growing unbounded inside the
      // sidebar's flex column — that's what keeps the primary nav items
      // (rendered as siblings, not children, of this component in
      // AppSidebar) pinned/visible no matter how many projects there are.
      // `flex-1 min-h-0` here (not the old `flex-shrink` alone) is
      // required: this Collapsible is itself a flex item inside the
      // wrapper's own `flex min-h-0 flex-1 flex-col` (app-sidebar.tsx) --
      // without `flex-1` this element sized itself to its own CONTENT
      // height (the default flex `min-height: auto` behaviour) instead of
      // stretching to fill the space the wrapper actually gave it, so the
      // CollapsibleContent's `overflow-y-auto` below never had a bounded
      // ancestor to overflow against and silently never engaged --
      // projects past the first couple rows were simply invisible with no
      // scroll affordance (F119, AS-069).
      className="flex min-h-0 flex-1 flex-col border-t"
      // UX: `min-h-[140px]` gives the Projects section real, always-visible
      // breathing room even alongside a full primary-nav block above it --
      // it was previously free to be squeezed down to a sliver (or fully
      // 0-height, per AS-512's "last resort" comment above) whenever the
      // combined content of both sections slightly exceeded the sidebar's
      // available height, which read as "barely any room for projects"
      // even on an ordinary-height viewport. This floor only ever engages
      // in that edge case; a normal viewport already gives this section
      // more room than the floor via its own `flex-1`.
      style={{ minHeight: 140 }}
    >
      <CollapsibleTrigger
        render={
          <button
            type="button"
            // F332 (M17 scrutiny BLOCKER-1 / AS-518): `max-md:min-h-11` --
            // same breakpoint convention as the other mobile-Sheet nav
            // controls in this file/app-sidebar.tsx.
            className="flex min-h-10 shrink-0 items-center justify-between px-2 mt-2 mb-1 py-2.5 text-xs text-muted-foreground uppercase tracking-wide hover:text-foreground max-md:min-h-11"
          >
            <span>Projects</span>
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                open ? "rotate-0" : "-rotate-90",
              )}
            />
          </button>
        }
      />
      {/* F119 (AS-069): `flex-1 min-h-0` so this panel actually fills the
          remaining space below the trigger above (rather than sizing to
          its own content) -- that bounded height is what makes
          `overflow-y-auto` a real, working scroll container instead of a
          no-op. */}
      <CollapsibleContent className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {projects.length === 0 ? (
          <div className="flex flex-col gap-2 px-3 pb-3">
            <p className="text-sm text-sidebar-foreground/60">
              No projects yet.
            </p>
            <NewProjectDialog workspaceId={workspaceId} />
          </div>
        ) : (
          // BUGFIX: `max-h-64` was a redundant, arbitrary hard cap on top
          // of the OUTER CollapsibleContent's own `min-h-0 overflow-y-auto`
          // (AS-512's actual "bounded to whatever room remains" mechanism,
          // just above). With favourites + the rest of the list only
          // slightly over 256px tall, this inner cap forced a scrollbar to
          // appear even when the outer flex container had plenty of free
          // space below it — the sidebar didn't need to scroll at all for
          // a handful of projects, but looked like it did. Removing the
          // fixed cap lets this list size itself naturally; the outer
          // container's own overflow-y-auto is still there as the real
          // safety net for a workspace with dozens of projects.
          <nav
            aria-label="Projects"
            className="flex flex-col gap-0.5 px-2 pb-2"
          >
            {favoriteProjects.length > 0 && (
              // AS-510: the pinned favourites group, rendered first (above
              // the rest of the list) with its own small label so it reads
              // as a distinct group rather than just "some projects out of
              // order".
              <div
                aria-label="Favourite projects"
                className="flex flex-col gap-0.5 pb-1"
              >
                <p className="px-2 mb-1 mt-3 text-xs text-muted-foreground uppercase tracking-wide">
                  Favourites
                </p>
                {favoriteProjects.map((project) => renderProjectRow(project))}
              </div>
            )}
            {/* Sidebar drag-and-drop reorder: only the non-favourite
                group is a dnd-kit sortable list -- favourites stay
                alphabetically sorted (manual ordering explicitly out of
                scope for that group per AS-510's own clarification,
                above). */}
            {isTrueEmptyRecents ? (
              // F040 (M3 scrutiny FU-2, SB-042): 0 favourites AND 0
              // recognised recent visits -- render this section's own
              // empty state (every other project is still reachable via
              // the "All projects" link below, SB-044) rather than an
              // arbitrary slice of the full, unrelated project list.
              <p className="px-2 py-1.5 text-sm text-sidebar-foreground/60">
                No recent projects. Browse all projects below.
              </p>
            ) : (
              <DndContext
                // F272 (part 3): explicit, stable id -- see
                // components/board/board.tsx's `DndContext` for the full
                // rationale (dnd-kit's counter-based auto-id otherwise
                // drifts between the server's per-request-fresh counter and
                // the client's already-incremented one whenever more than
                // one `DndContext` mounts across the app in a given
                // session, producing a hydration `aria-describedby`
                // mismatch on every page that renders this sidebar).
                id="sidebar-project-reorder"
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={otherProjects.map((p) => p.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {otherProjects.map((project) => (
                    <SortableProjectRow key={project.id} project={project} />
                  ))}
                </SortableContext>
              </DndContext>
            )}
          </nav>
        )}
        {/* F011 (SB-044): the section always ends with a link to the
            full projects page -- rendered regardless of the empty state
            above it (an empty/short favourites-or-recent list is exactly
            when a way to reach every other project matters most). */}
        <div className="mt-auto shrink-0 border-t px-2 py-2">
          <Link
            href={`/w/${workspaceSlug}/projects`}
            onClick={onNavigate}
            className="flex min-h-8 items-center rounded-[4px] px-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground max-md:min-h-11"
          >
            All projects
          </Link>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
