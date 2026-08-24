"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { FileText, FolderKanban, History, Loader2, User, Zap } from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { searchPalette, resolveRecentItems } from "@/lib/actions/palette-search";
// F146 (AS-258): the single "KEY-NUMBER" formatter, reused here rather
// than re-concatenating projectKey/number locally.
import { formatTaskKey } from "@/lib/tasks/task-key";
import type {
  PaletteSearchResults,
  ResolvedRecentItems,
} from "@/lib/palette/palette-search-types";
import { PALETTE_ACTIONS } from "@/components/command/actions";
import { useRecentItems } from "@/lib/hooks/use-recent-items";
import { useMembership } from "@/components/auth/membership-provider";

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
// F243 (AS-462, AS-465): quick actions (components/command/actions.ts) and
// recents (lib/hooks/use-recent-items.ts + resolveRecentItems) render in
// the SAME `<CommandList>` below, ONLY for the empty-query state — the
// moment the caller types anything, F242's search results above take
// over, matching this feature's "recent items appear when the query is
// empty" assertion text exactly.
const EMPTY_RESULTS: PaletteSearchResults = {
  projects: [],
  tasks: [],
  members: [],
};

const EMPTY_RECENTS: ResolvedRecentItems = { projects: [], tasks: [] };

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
  const { theme, setTheme } = useTheme();
  const membership = useMembership();
  const { pointers: recentPointers, addRecent } = useRecentItems(workspaceId);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<PaletteSearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = React.useState(false);
  const [recents, setRecents] = React.useState<ResolvedRecentItems>(EMPTY_RECENTS);

  const latestRequestId = React.useRef(0);
  const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // AS-465: resolve recents (against the caller's CURRENT visibility —
  // see resolveRecentItems's own doc comment) every time the palette
  // opens with an empty query, not once at mount — this is cheap (a
  // capped, indexed `.in()` read) and guarantees a stale/now-inaccessible
  // pointer never renders even if the caller's access changed since the
  // last time the palette was open.
  React.useEffect(() => {
    if (!open) return;

    let cancelled = false;

    resolveRecentItems(workspaceId, recentPointers)
      .then((resolved) => {
        if (!cancelled) setRecents(resolved);
      })
      .catch((error) => {
        console.error("CommandPalette: resolveRecentItems failed:", error);
        if (!cancelled) setRecents(EMPTY_RECENTS);
      });

    return () => {
      cancelled = true;
    };
    // recentPointers intentionally omitted: it changes on every
    // `addRecent` call (including the one this same open session may
    // trigger via `navigate` below), which would otherwise re-fire this
    // resolve mid-session. Re-resolving on every `open` transition is
    // sufficient for AS-465 ("recent items appear when the query is
    // empty") — the pointer list read inside the effect is always the
    // latest one via the closure's `recentPointers` at effect-run time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, workspaceId]);

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

  // AS-465: record a visit whenever the caller actually opens a project
  // or task from the palette (search result OR recent item) — the only
  // in-scope signal this feature has for "the caller looked at this"
  // (see components/command/actions.ts's own header comment on why
  // create-task/create-project route to an existing page rather than
  // duplicating a form here; recents tracking follows the same "stay in
  // the files this feature owns" boundary and does not instrument board/
  // task-detail pages outside this component).
  function navigateAndRecord(
    path: string,
    item: { type: "project" | "task"; id: string },
  ) {
    addRecent(item);
    navigate(path);
  }

  const visiblePaletteActions = PALETTE_ACTIONS.filter((action) =>
    action.isVisible({
      role: membership?.role ?? null,
      workspaceSlug,
      theme,
    }),
  );

  const hasRecents = recents.projects.length > 0 || recents.tasks.length > 0;

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
          {!hasQuery && visiblePaletteActions.length === 0 && !hasRecents && (
            <CommandEmpty>Type to search projects, tasks, and people.</CommandEmpty>
          )}

          {/* AS-462: quick actions — permission-filtered above via
              `visiblePaletteActions`; shown only for the empty-query
              state (typing narrows straight to F242's search results). */}
          {!hasQuery && visiblePaletteActions.length > 0 && (
            <CommandGroup heading="Actions">
              {visiblePaletteActions.map((action) => (
                <CommandItem
                  key={`action-${action.id}`}
                  value={`action-${action.id}`}
                  onSelect={() => {
                    const { navigateTo } = action.run({
                      role: membership?.role ?? null,
                      workspaceSlug,
                      theme,
                      setTheme,
                    });
                    if (navigateTo) {
                      navigate(navigateTo);
                    } else {
                      setOpen(false);
                    }
                  }}
                >
                  <Zap className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span>{action.label}</span>
                  {action.shortcut && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {action.shortcut}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {/* AS-465: recent items — visibility-checked server-side by
              `resolveRecentItems` on every open, never rendered from the
              raw localStorage pointers directly. */}
          {!hasQuery && hasRecents && (
            <CommandGroup heading="Recent">
              {recents.projects.map((project) => (
                <CommandItem
                  key={`recent-project-${project.id}`}
                  value={`recent-project-${project.id}`}
                  onSelect={() =>
                    navigateAndRecord(
                      `/w/${workspaceSlug}/projects/${project.id}/board`,
                      { type: "project", id: project.id },
                    )
                  }
                >
                  <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <FolderKanban className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span>{project.name}</span>
                  {project.key && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      {project.key}
                    </span>
                  )}
                </CommandItem>
              ))}
              {recents.tasks.map((task) => (
                <CommandItem
                  key={`recent-task-${task.id}`}
                  value={`recent-task-${task.id}`}
                  onSelect={() =>
                    navigateAndRecord(
                      `/w/${workspaceSlug}/projects/${task.projectId}/board`,
                      { type: "task", id: task.id },
                    )
                  }
                >
                  <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{task.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatTaskKey(task.projectKey, task.number) ?? task.projectName}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
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
                    navigateAndRecord(
                      `/w/${workspaceSlug}/projects/${project.id}/board`,
                      { type: "project", id: project.id },
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
                    navigateAndRecord(
                      `/w/${workspaceSlug}/projects/${task.projectId}/board`,
                      { type: "task", id: task.id },
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
