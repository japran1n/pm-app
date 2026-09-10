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
import { useState } from "react";
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
  // Same "no provider in the tree is a permissive default" convention
  // membership-provider.tsx documents on its own `useMembership` — a
  // viewer/guest (canWrite === false) can still see the list but can't
  // drag; every other caller (including every test that doesn't wrap
  // this in a MembershipProvider) can.
  const canReorder = membership ? canWrite({ role: membership.role }) : true;

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
  const favoriteProjects = orderedProjects
    .filter((project) => favoriteIds.has(project.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  // The non-favourite group IS drag-reorderable (this feature) — its
  // order is `orderedIds` (the local, optimistic mirror of
  // `sidebar_position`), not the raw prop order, so a completed drag
  // renders in its new position immediately, before the server round
  // trip resolves.
  const otherProjects = orderedProjects.filter(
    (project) => !favoriteIds.has(project.id),
  );

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

    const otherIds = otherProjects.map((p) => p.id);
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

    reorderProject(String(active.id), newPosition).then((result) => {
      if (!result.ok) {
        toast.error(result.error);
        setOrderedIds(previousOrderedIds);
      }
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
        {/* UX: the icon/colour-dot/key-abbreviation identifier chain was
            removed from this row entirely -- the row is now just
            [grip] [name] [star], per the "no icon, no dot, no key" polish
            pass. */}
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
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
          "group flex items-center gap-2.5 rounded-[4px] px-2 py-1.5 text-sm transition-colors max-md:min-h-11",
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
            className="flex min-h-10 shrink-0 items-center justify-between px-2 mt-3 mb-1 py-2.5 text-xs text-muted-foreground uppercase tracking-wide hover:text-foreground max-md:min-h-11"
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
          </nav>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
