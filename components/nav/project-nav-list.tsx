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

export type SidebarProjectItem = {
  id: string;
  name: string;
  key: string | null;
};

// Projects have no `color` column (checked supabase/migrations — F145's
// project-keys migration added `key`/`task_counter` only, no colour field,
// and no later migration adds one either). Per this feature's clarified
// "simpler option, no new dependency, no second source of truth" answer:
// rather than a schema migration just for a nav dot, the colour is derived
// deterministically from the project id against a small fixed Tailwind
// palette, so the same project always shows the same dot colour without
// any stored state.
const DOT_COLORS = [
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-orange-500",
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

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      // AS-512: this section owns its own bounded, internally-scrolling
      // area (min-h-0 + max-h + overflow-y-auto below) rather than growing
      // unbounded inside the sidebar's flex column — that's what keeps the
      // primary nav items (rendered as siblings, not children, of this
      // component in AppSidebar) pinned/visible no matter how many
      // projects there are.
      className="flex min-h-0 flex-shrink flex-col border-t"
    >
      <CollapsibleTrigger
        render={
          <button
            type="button"
            className="flex items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60 hover:text-sidebar-foreground"
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
      <CollapsibleContent className="min-h-0 overflow-y-auto">
        {projects.length === 0 ? (
          <div className="flex flex-col gap-2 px-3 pb-3">
            <p className="text-sm text-sidebar-foreground/60">
              No projects yet.
            </p>
            <NewProjectDialog workspaceId={workspaceId} />
          </div>
        ) : (
          <nav
            aria-label="Projects"
            className="flex max-h-64 flex-col gap-0.5 overflow-y-auto px-2 pb-2"
          >
            {projects.map((project) => {
              const href = `/w/${workspaceSlug}/projects/${project.id}/board`;
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
                    "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
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
                </Link>
              );
            })}
          </nav>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
