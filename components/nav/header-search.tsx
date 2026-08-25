"use client";

// F267 (AS-519, AS-520, AS-521, AS-522): the always-visible header search
// input.
//
// "Two search entry points must not become two search implementations —
// one query module, two surfaces" (this feature's own clarification
// note): this component calls the SAME `searchPalette` Server Action
// F242's command palette already uses (lib/actions/palette-search.ts) —
// no second ranking/visibility implementation is written here. The
// debounce/stale-response-guard convention (a monotonically increasing
// request id; only the latest in-flight request's response is applied)
// is copied verbatim from components/command/command-palette.tsx's own
// `handleQueryChange`, same `DEBOUNCE_MS`, for the same reason: ordering
// correctness has to live on the caller side since there is no
// server-side cancellation primitive for Server Actions in this
// codebase.
//
// AS-520 asks specifically for "matching tasks and projects" in the
// dropdown — this component renders the `projects`/`tasks` groups from
// `searchPalette`'s result and deliberately leaves out the `members`
// group (the command palette's own "People" group) to match that wording
// exactly; a member is not a task or a project, and Cmd+K remains the
// surface for finding people.
//
// AS-522 (Enter opens the full search page with the same query): reads
// the EXACT contract the existing `/search` page itself uses --
// `searchParams: Promise<{ q?: string }>` (see that page's own file) --
// so `router.push` here writes `?q=` and lands the caller on the same
// state a manual visit to that URL would produce.
//
// AS-521 (selecting a result navigates to it): reuses the SAME navigation
// targets command-palette.tsx already uses for project/task results
// (`/w/[slug]/projects/[projectId]/board`) -- there is no other
// query-param-driven task/project detail route in this codebase (see
// that file's own header comment), so this is not a second, invented
// destination.

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileText, FolderKanban, Loader2, Search as SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { searchPalette } from "@/lib/actions/palette-search";
import { formatTaskKey } from "@/lib/tasks/task-key";
import type { PaletteSearchResults } from "@/lib/palette/palette-search-types";
import { useEscapeLayer, SHORTCUT_EVENTS } from "@/lib/hooks/use-shortcut";
import { cn } from "@/lib/utils";

const EMPTY_RESULTS: PaletteSearchResults = { projects: [], tasks: [], members: [] };

// Same debounce window command-palette.tsx already established for this
// exact Server Action -- kept identical so the two surfaces feel
// consistent, not because either value is individually load-bearing.
const DEBOUNCE_MS = 200;

export function HeaderSearch({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<PaletteSearchResults>(EMPTY_RESULTS);
  const [loading, setLoading] = React.useState(false);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  // AS-523/MAJ-8: active-index keyboard navigation state -- -1 means
  // "nothing highlighted yet", matching the ARIA combobox pattern (no
  // aria-activedescendant until the user actually presses an arrow key).
  const [activeIndex, setActiveIndex] = React.useState(-1);

  const latestRequestId = React.useRef(0);
  const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const hasResults = results.projects.length > 0 || results.tasks.length > 0;

  // AS-520: the dropdown is visible only once there's something to show
  // for it -- an in-flight search, a result, or an explicit "no results"
  // state -- and only while the input still has focus/the caller hasn't
  // dismissed it.
  const showDropdown = dropdownOpen && hasQuery;

  // AS-523/MAJ-8: a single flattened list (projects first, then tasks --
  // the same order they render in) so Arrow/Home/End and
  // aria-activedescendant can address "the Nth option" without caring
  // which group it's in.
  const flatOptions = React.useMemo(
    () => [
      ...results.projects.map((project) => ({
        id: `header-search-option-project-${project.id}`,
        onSelect: () => navigate(`/w/${workspaceSlug}/projects/${project.id}/board`),
      })),
      ...results.tasks.map((task) => ({
        id: `header-search-option-task-${task.id}`,
        onSelect: () => navigate(`/w/${workspaceSlug}/projects/${task.projectId}/board`),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- navigate is a stable local function, re-derived from results/workspaceSlug only
    [results, workspaceSlug],
  );

  function clearAndClose() {
    latestRequestId.current += 1;
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    setQuery("");
    setResults(EMPTY_RESULTS);
    setLoading(false);
    setDropdownOpen(false);
    setActiveIndex(-1);
  }

  // Escape clears the input and closes the dropdown via the SAME shared
  // escape-layer stack F244 built (lib/hooks/use-shortcut.ts) -- not a
  // second `keydown` listener. Only registered as the topmost layer while
  // there is actually something open to close, so Escape falls through to
  // whatever's beneath (e.g. a dialog) once the dropdown has nothing left
  // to dismiss.
  useEscapeLayer(showDropdown, () => {
    clearAndClose();
    inputRef.current?.blur();
  });

  // F244 (AS-468's "/" shortcut): reuse the SAME shared "open search"
  // event the command palette already listens for, rather than a second,
  // parallel shortcut wired up here -- pressing "/" focuses this header
  // input in addition to the palette opening (both are valid "search"
  // entry points per this feature's own clarification: "one query
  // module, two surfaces"). Harmless even though the palette's own
  // dialog, once open, ends up holding focus on top of this input -- see
  // this feature's handoff for the full reasoning.
  React.useEffect(() => {
    function onOpenSearch() {
      inputRef.current?.focus();
    }
    window.addEventListener(SHORTCUT_EVENTS.openSearch, onOpenSearch);
    return () => window.removeEventListener(SHORTCUT_EVENTS.openSearch, onOpenSearch);
  }, []);

  // Close the dropdown on an outside click (clicking elsewhere on the
  // page is not something the shared Escape-layer stack handles -- that
  // stack is keyboard-only).
  React.useEffect(() => {
    if (!showDropdown) return;

    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [showDropdown]);

  React.useEffect(() => {
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, []);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.value;
    setQuery(next);
    setDropdownOpen(true);
    setActiveIndex(-1);

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
        .then((next) => {
          // AS-520: a slower, stale response for an earlier keystroke must
          // never clobber a newer, faster one -- same guard as F242's
          // command palette.
          if (requestId !== latestRequestId.current) return;
          setResults(next);
          setLoading(false);
        })
        .catch((error) => {
          console.error("HeaderSearch: search failed:", error);
          if (requestId !== latestRequestId.current) return;
          setResults(EMPTY_RESULTS);
          setLoading(false);
        });
    }, DEBOUNCE_MS);
  }

  function navigate(path: string) {
    clearAndClose();
    router.push(path);
  }

  // AS-522: Enter (without an item already selected from the dropdown)
  // opens the existing `/search` page pre-filled with the same query --
  // reads the exact `?q=` contract that page's own `searchParams` prop
  // already expects.
  // AS-523/MAJ-8: Arrow/Home/End move a real `activeIndex` through the
  // flattened option list -- driving `aria-activedescendant` on the input
  // and `aria-selected` on the matching option -- so the combobox contract
  // this component already advertises (`role="combobox"`/`role="listbox"`)
  // is actually implemented, not just declared.
  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (showDropdown && flatOptions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % flatOptions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current <= 0 ? flatOptions.length - 1 : current - 1));
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setActiveIndex(flatOptions.length - 1);
        return;
      }
    }

    if (event.key !== "Enter") return;
    if (!trimmedQuery) return;
    event.preventDefault();

    // If the user has arrowed to a specific option, Enter activates that
    // option (mirrors mouse selection) rather than opening /search.
    if (showDropdown && activeIndex >= 0 && activeIndex < flatOptions.length) {
      flatOptions[activeIndex].onSelect();
      return;
    }

    navigate(`/w/${workspaceSlug}/search?q=${encodeURIComponent(trimmedQuery)}`);
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls="header-search-results"
        aria-activedescendant={
          showDropdown && activeIndex >= 0 && activeIndex < flatOptions.length
            ? flatOptions[activeIndex].id
            : undefined
        }
        aria-label="Search tasks and projects"
        placeholder="Search tasks and projects…"
        value={query}
        onChange={handleChange}
        onFocus={() => {
          if (hasQuery) setDropdownOpen(true);
        }}
        onKeyDown={handleKeyDown}
        className="pl-8"
      />

      {showDropdown && (
        <div
          id="header-search-results"
          role="listbox"
          className="absolute top-full left-0 z-50 mt-1 w-full max-h-80 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {loading && !hasResults && (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Searching…
            </div>
          )}

          {!loading && !hasResults && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No results found.
            </p>
          )}

          {results.projects.length > 0 && (
            <div className="mb-1">
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                Projects
              </p>
              {results.projects.map((project, index) => (
                <ResultRow
                  key={`project-${project.id}`}
                  id={`header-search-option-project-${project.id}`}
                  isActive={activeIndex === index}
                  onSelect={() =>
                    navigate(`/w/${workspaceSlug}/projects/${project.id}/board`)
                  }
                >
                  <FolderKanban className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{project.name}</span>
                  {project.key && (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {project.key}
                    </span>
                  )}
                </ResultRow>
              ))}
            </div>
          )}

          {results.tasks.length > 0 && (
            <div>
              <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
                Tasks
              </p>
              {results.tasks.map((task, index) => (
                <ResultRow
                  key={`task-${task.id}`}
                  id={`header-search-option-task-${task.id}`}
                  isActive={activeIndex === results.projects.length + index}
                  onSelect={() =>
                    navigate(`/w/${workspaceSlug}/projects/${task.projectId}/board`)
                  }
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{task.title}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {formatTaskKey(task.projectKey, task.number) ?? task.projectName}
                  </span>
                </ResultRow>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultRow({
  children,
  id,
  isActive,
  onSelect,
  className,
}: {
  children: React.ReactNode;
  id: string;
  isActive: boolean;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      // AS-523/MAJ-8: reflects the real active-index state driven by
      // Arrow/Home/End on the input, matching `aria-activedescendant`
      // above -- not hardcoded false.
      aria-selected={isActive}
      // AS-521: mousedown (not click) fires selection before the input's
      // own blur/outside-click handler could otherwise close the dropdown
      // first and drop the click.
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground",
        isActive && "bg-accent text-accent-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}
