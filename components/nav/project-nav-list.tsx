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
import { ChevronDown, FolderKanban } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { NewProjectDialog } from "@/components/new-project-dialog";
import { ProjectFavoriteButton } from "@/components/project-favorite-button";

export type SidebarProjectItem = {
  id: string;
  name: string;
  key: string | null;
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

// Projects have no `color` column (checked supabase/migrations — F145's
// project-keys migration added `key`/`task_counter` only, no colour field,
// and no later migration adds one either). Per this feature's clarified
// "simpler option, no new dependency, no second source of truth" answer:
// rather than a schema migration just for a nav dot, the colour is derived
// deterministically from the project id against a small fixed Tailwind
// palette, so the same project always shows the same dot colour without
// any stored state.
// F269 (AS-526): the original -500 Tailwind shades measured below 3:1
// against the sidebar background in the LIGHT theme (e.g. amber-500
// 2.08:1, teal-500 2.41:1, sky-500 2.68:1) — swapped for the darker -600
// shade in the same hue family (violet-500/-600 both cleared 3:1 on light
// but failed on the dark theme's near-black sidebar, so violet was
// replaced with purple-600, the nearest hue that clears 3:1 on BOTH
// themes) so every dot now clears the WCAG AA 3:1 non-text contrast
// threshold in both light and dark sidebars. See
// tests/unit/project-nav-dot-contrast.test.ts for the automated check.
//
// F338 (M18 scrutiny MAJ-3/FU-G, AS-526): the row this dot sits in isn't
// always plain `--sidebar` -- the active/hover state applies
// `bg-sidebar-accent` (see the className below), a genuinely different
// surface (#f5f5f5 light / #262626 dark) the original test never
// measured. Re-measured against that real surface, two entries failed:
// `bg-amber-600` (2.92:1 on the light accent row) and `bg-purple-600`
// (2.81:1 on the dark accent row). Swapped amber-600 -> amber-700 (clears
// both: 4.61:1 light / 3.01:1 dark) and purple-600 -> purple-500 (clears
// all four surfaces: >=3.63:1 everywhere it's measured). See
// tests/unit/project-nav-dot-contrast.test.ts.
const DOT_COLORS = [
  "bg-rose-600",
  "bg-amber-700",
  "bg-emerald-600",
  "bg-sky-600",
  "bg-purple-500",
  "bg-pink-600",
  "bg-teal-600",
  "bg-orange-600",
];

function colorForProjectId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return DOT_COLORS[hash % DOT_COLORS.length];
}

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

  if (projectIdsKey !== syncedProjectIdsKey) {
    setSyncedProjectIdsKey(projectIdsKey);
    setFavoriteIds(new Set(projects.filter((p) => p.isFavorite).map((p) => p.id)));
  }

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
  const favoriteProjects = projects
    .filter((project) => favoriteIds.has(project.id))
    .sort((a, b) => a.name.localeCompare(b.name));
  const otherProjects = projects.filter(
    (project) => !favoriteIds.has(project.id),
  );

  function renderProjectRow(project: SidebarProjectItem) {
    const href = `/w/${workspaceSlug}/projects/${project.id}/list`;
    const isActive =
      pathname === href ||
      pathname.startsWith(`/w/${workspaceSlug}/projects/${project.id}/`);

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
          "group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors max-md:min-h-11",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-2 shrink-0 rounded-full",
            colorForProjectId(project.id),
          )}
        />
        {project.key ? (
          <span className="shrink-0 text-xs font-semibold text-sidebar-foreground/50">
            {project.key}
          </span>
        ) : (
          <FolderKanban
            className="size-3.5 shrink-0 text-sidebar-foreground/50"
            aria-hidden="true"
          />
        )}
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
      </Link>
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
            className="flex min-h-10 shrink-0 items-center justify-between px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/70 hover:text-sidebar-foreground max-md:min-h-11"
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
                <p className="px-2.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground/40">
                  Favourites
                </p>
                {favoriteProjects.map(renderProjectRow)}
              </div>
            )}
            {otherProjects.map(renderProjectRow)}
          </nav>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
