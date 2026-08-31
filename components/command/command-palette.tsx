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
  PaletteTaskResult,
  ResolvedRecentItems,
} from "@/lib/palette/palette-search-types";
import { PALETTE_ACTIONS } from "@/components/command/actions";
import { useRecentItems } from "@/lib/hooks/use-recent-items";
import { usePaletteSearchRealtime } from "@/lib/hooks/use-palette-search-realtime";
import { useMembership } from "@/components/auth/membership-provider";
import { SHORTCUT_EVENTS } from "@/lib/hooks/use-shortcut";

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

// F030 (AS-023): a search response resolving AFTER a realtime patch has
// already updated a task's title must NOT clobber that patch — merge
// pending realtime patches into every incoming search response before
// calling `setResults`, rather than trusting the response verbatim.
// `applyRealtimePatches` is a pure helper (kept outside the component so
// it's trivially unit-testable) that layers a `Map<taskId, patch>` onto a
// `PaletteSearchResults`'s `tasks` array.
// AS-024 (F034 fix): a deleted task must stay excluded from search results
// even if a search request that was already in flight resolves AFTER the
// deletion. The realtime DELETE handler below used to `.delete(id)` the
// task out of `realtimePatches`, which meant "no patch recorded" -- a
// later-resolving search response naming that same (now-deleted) id had
// nothing to override it, so the deleted task would resurrect in the UI.
// Instead, deletion is recorded as an explicit tombstone entry
// (`{ _deleted: true }`) that stays in the map for the rest of this
// palette session, and `applyRealtimePatches` filters any task carrying
// that tombstone out of the merged results entirely (rather than patching
// its fields), so a stale search response can never bring it back.
type RealtimeTaskPatch = Partial<PaletteTaskResult> | { _deleted: true };

function isTombstone(
  patch: RealtimeTaskPatch,
): patch is { _deleted: true } {
  return "_deleted" in patch && patch._deleted === true;
}

function applyRealtimePatches(
  results: PaletteSearchResults,
  patches: Map<string, RealtimeTaskPatch>,
): PaletteSearchResults {
  if (patches.size === 0) return results;

  let changed = false;
  const tasks: PaletteTaskResult[] = [];
  for (const task of results.tasks) {
    const patch = patches.get(task.id);
    if (!patch) {
      tasks.push(task);
      continue;
    }
    changed = true;
    if (isTombstone(patch)) continue;
    tasks.push({ ...task, ...patch });
  }

  return changed ? { ...results, tasks } : results;
}

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
  // F030 (AS-023): pending realtime title patches, keyed by task id — see
  // `applyRealtimePatches` above and `handleRealtimeResults` below.
  const realtimePatches = React.useRef(new Map<string, RealtimeTaskPatch>());

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

  // F244 (AS-468): "/" opens/focuses this palette — dispatched by
  // components/command/shortcut-provider.tsx's SEPARATE bare-single-key
  // listener, not a second Cmd+K-style keydown handler in this file (see
  // that file's header comment for why the two listeners stay separate).
  // `CommandInput` already autofocuses on open, so reacting to this event
  // by opening satisfies "focuses search" without any extra state here.
  React.useEffect(() => {
    function onOpenSearch() {
      setOpen(true);
    }

    window.addEventListener(SHORTCUT_EVENTS.openSearch, onOpenSearch);
    return () =>
      window.removeEventListener(SHORTCUT_EVENTS.openSearch, onOpenSearch);
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
      realtimePatches.current.clear();
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
      realtimePatches.current.clear();
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
          // F030 (AS-023): re-apply any realtime title patches already
          // captured for tasks that reappear in this (possibly stale
          // w.r.t. realtime) search response, so a realtime rename never
          // gets reverted by a slower in-flight search.
          setResults(applyRealtimePatches(results, realtimePatches.current));
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

  // F012 (AS-023, AS-024): keep search results reconciled against live
  // task title changes/deletions while the palette is open with a query —
  // no-ops (and unsubscribes) once the query is empty, matching the
  // "recents, not search results" state above.
  // F030 (AS-023): wrap `setResults` so every realtime update is both
  // applied to the current results (existing F012 behaviour) AND recorded
  // in `realtimePatches` — diffing the reconciled state against the prior
  // state per task id, so a patch survives even if the task is momentarily
  // absent from `results` (e.g. mid-debounce) and reappears via a later
  // search response.
  const handleRealtimeResults = React.useCallback<
    React.Dispatch<React.SetStateAction<PaletteSearchResults>>
  >((update) => {
    setResults((current) => {
      const next =
        typeof update === "function"
          ? (update as (value: PaletteSearchResults) => PaletteSearchResults)(
              current,
            )
          : update;

      const previousTasksById = new Map(
        current.tasks.map((task) => [task.id, task] as const),
      );
      const nextTaskIds = new Set(next.tasks.map((task) => task.id));

      for (const task of next.tasks) {
        const previous = previousTasksById.get(task.id);
        if (!previous || previous.title !== task.title) {
          realtimePatches.current.set(task.id, { title: task.title });
        }
      }

      // AS-024 (F034 fix): a task that disappeared from `next`
      // (soft-deleted, per reconcilePaletteSearchResults) must be
      // tombstoned, NOT removed from `realtimePatches` -- removing the
      // entry entirely left a later-resolving, stale search response for
      // this same id with no patch to override it, resurrecting the
      // deleted task (AS-024 failure). The tombstone stays in the map for
      // the rest of this palette session so `applyRealtimePatches` keeps
      // filtering the task out of every future response.
      for (const id of previousTasksById.keys()) {
        if (!nextTaskIds.has(id)) {
          realtimePatches.current.set(id, { _deleted: true });
        }
      }

      return next;
    });
  }, []);

  usePaletteSearchRealtime(workspaceId, query, handleRealtimeResults);

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
