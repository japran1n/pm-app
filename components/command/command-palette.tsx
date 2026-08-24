"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, FolderKanban, Loader2, User } from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { searchPalette } from "@/lib/actions/palette-search";
// F146 (AS-258): the single "KEY-NUMBER" formatter, reused here rather
// than re-concatenating projectKey/number locally.
import { formatTaskKey } from "@/lib/tasks/task-key";
import type { PaletteSearchResults } from "@/lib/palette/palette-search-types";

// F241 (AS-459, AS-463, AS-464): the global command palette shell —
// mounted ONCE in the workspace layout so a single Cmd+K/Ctrl+K listener
// owns the shortcut rather than several palettes fighting over the same
// keydown.
//
// F242 (AS-460, AS-461, AS-466): this file now also owns the search
// results themselves — a debounced call into the `searchPalette` Server
// Action (lib/actions/palette-search.ts), grouped by type (AS-460),
// navigating on selection (AS-461), and an explicit no-results state
// (AS-466) distinct from both the initial "type to search" prompt and the
// in-flight loading state.
//
// F243 (AS-462/465, quick actions + recents) extends the SAME
// `<CommandList>` below with additional `CommandGroup`s rendered when the
// query is empty — no changes needed here for that to land.
const EMPTY_RESULTS: PaletteSearchResults = {
  projects: [],
  tasks: [],
  members: [],
};

// AS-460/AS-466: debounce so fast typing doesn't fire a query per
// keystroke, and so results can't render out of order — every dispatched
// search carries a monotonically increasing request id; a response is
// only applied if it is still the MOST RECENT request in flight when it
// resolves (a slow, stale response for an earlier keystroke is silently
// dropped rather than clobbering a newer, faster response).
const DEBOUNCE_MS = 200;

export function CommandPalette({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<PaletteSearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = React.useState(false);

  const latestRequestId = React.useRef(0);
  const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // AS-459: Cmd+K (Mac) / Ctrl+K (Windows/Linux) opens the palette from
  // anywhere. AS-464: it must NOT open from an unrelated keystroke while
  // typing in a text field — only this explicit chord opens it, even when
  // focus is inside a text input.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) return;

      const isModifierK =
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k";

      if (!isModifierK) return;

      event.preventDefault();
      setOpen((current) => !current);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Reset state whenever the dialog closes (driven from the `onOpenChange`
  // handler below, not an effect keyed on `open` — cmdk/Radix always call
  // `onOpenChange` for both open and close transitions here, so there is
  // no external-system event this needs to "synchronize" from; doing it in
  // the handler avoids an extra render-then-effect round trip), so the
  // next open starts from the neutral "type to search" prompt rather than
  // showing stale results.
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      latestRequestId.current += 1;
      setQuery("");
      setResults(EMPTY_RESULTS);
      setLoading(false);
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    }
  }

  // AS-460/466: debounced, stale-response-safe search, triggered directly
  // from the input's `onValueChange` handler rather than an effect keyed
  // on `query` — `CommandInput` already calls this exactly once per real
  // value change, so there is no external system to synchronize from here
  // either.
  function handleQueryChange(next: string) {
    setQuery(next);

    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }

    const trimmed = next.trim();

    if (!trimmed) {
      latestRequestId.current += 1;
      setResults(EMPTY_RESULTS);
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestId = ++latestRequestId.current;

    debounceTimer.current = setTimeout(() => {
      searchPalette(workspaceId, trimmed)
        .then((results) => {
          // AS-460/466: only the most recent request may update the UI —
          // a stale, slower response for an earlier keystroke is dropped.
          if (requestId !== latestRequestId.current) return;
          setResults(results);
          setLoading(false);
        })
        .catch((error) => {
          console.error("CommandPalette: search failed:", error);
          if (requestId !== latestRequestId.current) return;
          setResults(EMPTY_RESULTS);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
  }

  // Clear any pending debounce timer on unmount.
  React.useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const hasResults =
    results.projects.length > 0 ||
    results.tasks.length > 0 ||
    results.members.length > 0;

  function navigate(path: string) {
    setOpen(false);
    router.push(path);
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Command palette"
      description="Search or run a command"
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Type a command or search..."
          value={query}
          onValueChange={handleQueryChange}
        />
        <CommandList>
          {!hasQuery && (
            <CommandEmpty>Type to search projects, tasks, and people.</CommandEmpty>
          )}
          {/* AS-466: an explicit no-results state, distinct from the
              initial empty-query prompt above and from the in-flight
              loading state below. */}
          {hasQuery && !loading && !hasResults && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}
          {hasQuery && loading && !hasResults && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Searching...
            </div>
          )}

          {/* AS-460: results grouped by type. */}
          {results.projects.length > 0 && (
            <CommandGroup heading="Projects">
              {results.projects.map((project) => (
                <CommandItem
                  key={`project-${project.id}`}
                  value={`project-${project.id}`}
                  onSelect={() =>
                    navigate(
                      `/w/${workspaceSlug}/projects/${project.id}/board`,
                    )
                  }
                >
                  <FolderKanban className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span>{project.name}</span>
                  {project.key && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {project.key}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {results.tasks.length > 0 && (
            <CommandGroup heading="Tasks">
              {results.tasks.map((task) => (
                <CommandItem
                  key={`task-${task.id}`}
                  value={`task-${task.id}`}
                  onSelect={() =>
                    navigate(
                      `/w/${workspaceSlug}/projects/${task.projectId}/board`,
                    )
                  }
                >
                  <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{task.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatTaskKey(task.projectKey, task.number) ??
                      task.projectName}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {results.members.length > 0 && (
            <CommandGroup heading="People">
              {results.members.map((member) => (
                <CommandItem
                  key={`member-${member.userId}`}
                  value={`member-${member.userId}`}
                  onSelect={() =>
                    navigate(`/w/${workspaceSlug}/settings/members`)
                  }
                >
                  <User className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span>{member.name ?? member.email ?? "Unknown"}</span>
                  {member.name && member.email && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {member.email}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
