"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderKanban } from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// Follow-up (Cmd+P project switcher): a small, focused modal — separate
// from CommandPalette (Cmd+K, F241/F242/F243) rather than a "mode=projects"
// filter bolted onto it. CommandPalette's query goes to a debounced Server
// Action (searchPalette) and mixes projects/tasks/members/quick actions/
// recents; this switcher only ever lists the projects already fetched for
// the current workspace by the layout (the SAME `sidebarProjects` list
// AppSidebar renders — no second query), filtered client-side by cmdk's
// own built-in fuzzy `shouldFilter` (left at its default `true`, unlike
// CommandPalette which disables it in favour of server-side search).
// Reusing CommandPalette's Cmd+K wiring for a totally different dataset and
// UX (no debounce, no grouping by result type, no quick actions) would mean
// threading a "mode" flag through search/debounce/realtime logic that has
// nothing to do with this feature — a second small component is the
// simpler, lower-risk seam.
//
// AUTONOMOUS_DECISION: bound to Cmd+P/Ctrl+P via its OWN `document`
// keydown listener, mirroring CommandPalette's own Cmd+K listener exactly
// (see that file's header comment for why modified-key chords each own a
// dedicated listener rather than being merged into the bare-single-key
// ShortcutProvider, which only ever reacts to un-modified keys). Browsers'
// native Cmd+P (print) is prevented via `event.preventDefault()`, the same
// tradeoff every app with a Cmd+P command menu (Linear, Notion, GitHub)
// makes — printing is available from the browser's menu/Cmd+Shift+P print
// dialog regardless.
export type ProjectSwitcherProject = {
  id: string;
  name: string;
  key: string | null;
};

export function ProjectSwitcher({
  workspaceSlug,
  projects,
}: {
  workspaceSlug: string;
  projects: ProjectSwitcherProject[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return;

      const isModifierP =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "p";

      if (!isModifierP) return;

      event.preventDefault();
      setOpen((current) => !current);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  function navigate(projectId: string) {
    setOpen(false);
    // "/list" is this app's default project route (project List view) —
    // matching the Clarified implementation's routing choice.
    router.push(`/w/${workspaceSlug}/projects/${projectId}/list`);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Switch project"
      description="Jump to a project in this workspace"
    >
      <Command>
        <CommandInput placeholder="Find a project..." />
        <CommandList>
          <CommandEmpty>No projects found.</CommandEmpty>
          <CommandGroup heading="Projects">
            {projects.map((project) => (
              <CommandItem
                key={project.id}
                value={`${project.name} ${project.key ?? ""}`}
                onSelect={() => navigate(project.id)}
              >
                <FolderKanban className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span>{project.name}</span>
                {project.key && (
                  <span className="ml-auto text-micro text-muted-foreground">
                    {project.key}
                  </span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
