"use client";

// F157: task detail's Dependencies section (AS-277: both directions
// shown; AS-282: removal from either side; the card indicator itself is
// AS-283, implemented separately in task-card.tsx).
//
// Pattern: same deviation from the clarified spec's default ("Server
// Component for data-fetching, thin Client Component only for the
// interactive part") that SubtaskList (F150) and Checklist (F153)
// already document — this component is composed *inside*
// task-detail-sheet.tsx, itself already a Client Component. The caller
// (getTaskDetail, via TaskDetailSheet) fetches this task's own
// dependency rows — BOTH directions, in the SAME query that fetches the
// task itself (lib/actions/tasks.ts's getTaskDetail) — and passes them
// down as `blockedBy`/`blocks`; this component owns rendering plus the
// add/remove interactive behaviour. No per-row round trip.
//
// Layout: follows the exact section shape SubtaskList/Checklist already
// established (a Label + count/action row, an empty-state line with an
// icon, a <ul> of rows, each row text-clickable to open the related task)
// rather than inventing a new visual pattern — this is two of those
// sections stacked (one per direction), not a new list primitive.
//
// AS-277 ("both sides show their relations"): a task's Dependencies
// section always renders BOTH the "Blocked by" and "Blocks" halves,
// regardless of which one has rows — an empty half still renders its own
// label + empty-state line (same "always show the section" convention
// SubtaskList/Checklist use), so a task that only blocks others (but
// isn't itself blocked) still visibly has a "Blocked by" section proving
// it has none, not a section that silently disappears.
//
// AS-282 ("removed by either side"): the remove button on every row calls
// deleteDependency(dependencyId) — the SAME action regardless of whether
// the row is being removed from the blocking task's own Dependencies
// section or the blocked task's. There is no "am I the blocking or
// blocked side" branch anywhere in this file; the dependency row's own id
// (threaded through by getTaskDetail) is the only thing either call site
// needs. See lib/actions/dependencies.ts's deleteDependency for the
// server-side half of why this is symmetric (F155's DELETE RLS policy
// checks membership via the row's shared workspace, not "which task
// opened the sheet").
//
// Picker / cycle exclusion: per this feature's critical context, the
// "Add" picker for each direction excludes any candidate that would
// create a cycle, rather than letting the user pick one and then
// showing an error. This component does NOT walk the dependency graph
// itself — it calls lib/actions/dependencies.ts's
// getDependencyCandidates, which filters candidates using the
// get_dependency_ancestors/get_dependency_descendants SQL functions this
// feature's migration adds (reusing F156's own recursive-CTE reachability
// walk, never a second TypeScript implementation of it).
//
// Search UI: Popover + Command (components/ui/popover.tsx,
// components/ui/command.tsx), the existing shadcn/cmdk primitives already
// in this codebase (tech-decisions.md: cmdk was added for the future
// command palette, F242) — reused here rather than a bespoke combobox,
// per the Clarified implementation's "existing primitives, no new
// parallel implementation" answer. `shouldFilter={false}` because
// filtering is server-side (workspace-scoped, cycle-excluded) — cmdk's
// own client-side substring filter would just re-filter an already
// correct, already-small result set for no benefit, and could otherwise
// visually hide a result whose display text doesn't literally contain
// the typed string (e.g. a key-only match).
//
// Access control note (same as SubtaskList's/Checklist's own documented
// decision): lib/auth/permissions.ts does not exist yet in this codebase
// (AS-230's own not-yet-built feature, M11 lands after M13 in this
// mission's plan). Every control here is available to any active
// workspace member and re-verified server-side by each Server Action
// itself (requireActiveMembership, lib/actions/dependencies.ts) — same
// convention every sibling section of this Sheet already follows.
//
// Failure handling: matches every sibling section's convention — a
// failed add/remove shows a sonner toast naming what failed and leaves
// the control in an actionable state; a successful add/remove updates
// local state immediately (no re-fetch of the whole task).

import { useState, useTransition } from "react";
import { Link2, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";

import {
  createDependency,
  deleteDependency,
  getDependencyCandidates,
  type DependencyCandidate,
} from "@/lib/actions/dependencies";
import { formatTaskKey } from "@/lib/tasks/task-key";
import { STATUS_COLORS, STATUS_LABELS } from "@/lib/task-colors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// A dependency row from THIS task's point of view, joined with just
// enough of the related task to render and open it (getTaskDetail's own
// query, see lib/actions/tasks.ts). `dependencyId` is the
// `task_dependencies.id` row itself — the only thing deleteDependency
// needs (AS-282).
export type DependencyRelatedTask = {
  dependencyId: string;
  taskId: string;
  title: string;
  status: "todo" | "in_progress" | "in_review" | "done";
  projectKey?: string;
  number?: number;
};

type Direction = "blockedBy" | "blocks";

function relatedTaskLabel(item: {
  title: string;
  projectKey?: string;
  number?: number;
}): string {
  return formatTaskKey(item.projectKey, item.number) ?? item.title;
}

export function Dependencies({
  taskId,
  blockedBy,
  blocks,
  onOpenTask,
}: {
  /** The task this Dependencies section belongs to. */
  taskId: string;
  /** F157 (AS-277): tasks that block THIS task — "Blocked by". From
   * getTaskDetail's own query. */
  blockedBy: DependencyRelatedTask[];
  /** F157 (AS-277): tasks THIS task blocks — "Blocks". From
   * getTaskDetail's own query. */
  blocks: DependencyRelatedTask[];
  /** F150-style "open a different task in this same Sheet" callback,
   * passed straight through from TaskDetailSheet. Undefined hides no UI
   * — rows still render, they just aren't clickable, matching
   * SubtaskList's identical optional-onOpenTask convention. */
  onOpenTask?: (taskId: string) => void;
}) {
  const [localBlockedBy, setLocalBlockedBy] = useState(blockedBy);
  const [localBlocks, setLocalBlocks] = useState(blocks);
  // Same "adjust state during render on prop change" convention as
  // SubtaskList/Checklist's own syncedTaskId — re-syncs local state
  // whenever a different task's data is passed down (Sheet opened for a
  // new task), with no Effect.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalBlockedBy(blockedBy);
    setLocalBlocks(blocks);
  }

  return (
    <div className="flex flex-col gap-4">
      <DependencySection
        title="Blocked by"
        emptyLabel="Not blocked by any task."
        taskId={taskId}
        direction="blockedBy"
        items={localBlockedBy}
        onOpenTask={onOpenTask}
        onAdded={(item) =>
          setLocalBlockedBy((previous) => [...previous, item])
        }
        onRemoved={(dependencyId) =>
          setLocalBlockedBy((previous) =>
            previous.filter((item) => item.dependencyId !== dependencyId),
          )
        }
      />
      <DependencySection
        title="Blocks"
        emptyLabel="Doesn't block any task."
        taskId={taskId}
        direction="blocks"
        items={localBlocks}
        onOpenTask={onOpenTask}
        onAdded={(item) => setLocalBlocks((previous) => [...previous, item])}
        onRemoved={(dependencyId) =>
          setLocalBlocks((previous) =>
            previous.filter((item) => item.dependencyId !== dependencyId),
          )
        }
      />
    </div>
  );
}

function DependencySection({
  title,
  emptyLabel,
  taskId,
  direction,
  items,
  onOpenTask,
  onAdded,
  onRemoved,
}: {
  title: string;
  emptyLabel: string;
  taskId: string;
  direction: Direction;
  items: DependencyRelatedTask[];
  onOpenTask?: (taskId: string) => void;
  onAdded: (item: DependencyRelatedTask) => void;
  onRemoved: (dependencyId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<DependencyCandidate[]>([]);
  const [isSearching, startSearchTransition] = useTransition();
  const [isAdding, startAddTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);

  function runSearch(nextQuery: string) {
    setQuery(nextQuery);
    startSearchTransition(async () => {
      const result = await getDependencyCandidates(
        taskId,
        direction,
        nextQuery,
      );
      if (result.ok) {
        setCandidates(result.data);
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      runSearch("");
    }
  }

  function handleSelect(candidate: DependencyCandidate) {
    startAddTransition(async () => {
      // "blockedBy": candidate blocks this task -> (blocking=candidate,
      // blocked=taskId). "blocks": this task blocks candidate ->
      // (blocking=taskId, blocked=candidate).
      const result =
        direction === "blockedBy"
          ? await createDependency(candidate.id, taskId)
          : await createDependency(taskId, candidate.id);

      if (result.ok) {
        onAdded({
          dependencyId: result.data.id,
          taskId: candidate.id,
          title: candidate.title,
          status: candidate.status,
          projectKey: candidate.projectKey,
          number: candidate.number,
        });
        setOpen(false);
        setQuery("");
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleRemove(item: DependencyRelatedTask) {
    setRemovingId(item.dependencyId);
    startAddTransition(async () => {
      const result = await deleteDependency(item.dependencyId);
      setRemovingId(null);
      if (result.ok) {
        onRemoved(item.dependencyId);
        toast.success("Dependency removed.");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <Popover open={open} onOpenChange={handleOpenChange}>
          <PopoverTrigger
            render={
              <Button type="button" variant="ghost" size="sm">
                <Plus className="size-3.5" aria-hidden="true" />
                Add
              </Button>
            }
          />
          <PopoverContent align="end" className="w-80 p-0">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search by key or title…"
                value={query}
                onValueChange={runSearch}
              />
              <CommandList>
                {isSearching ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-mini text-muted-foreground">
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    Searching…
                  </div>
                ) : (
                  <>
                    <CommandEmpty>No matching tasks.</CommandEmpty>
                    <CommandGroup>
                      {candidates.map((candidate) => {
                        const key = formatTaskKey(
                          candidate.projectKey,
                          candidate.number,
                        );
                        return (
                          <CommandItem
                            key={candidate.id}
                            value={candidate.id}
                            disabled={isAdding}
                            onSelect={() => handleSelect(candidate)}
                          >
                            {key && (
                              <span className="font-mono text-micro text-muted-foreground">
                                {key}
                              </span>
                            )}
                            <span className="flex-1 truncate">
                              {candidate.title}
                            </span>
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {items.length === 0 ? (
        <div className="flex items-center gap-2 text-mini text-muted-foreground">
          <Link2 className="size-4" aria-hidden="true" />
          {emptyLabel}
        </div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => {
            const key = formatTaskKey(item.projectKey, item.number);
            const isRemoving = removingId === item.dependencyId;

            return (
              <li
                key={item.dependencyId}
                className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-accent"
              >
                <button
                  type="button"
                  onClick={
                    onOpenTask ? () => onOpenTask(item.taskId) : undefined
                  }
                  disabled={!onOpenTask}
                  aria-label={`Open ${relatedTaskLabel(item)}`}
                  className="flex flex-1 items-center gap-2 truncate text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default"
                >
                  {key && (
                    <span className="font-mono text-micro text-muted-foreground">
                      {key}
                    </span>
                  )}
                  <span className="flex-1 truncate text-mini">
                    {item.title}
                  </span>
                  <Badge variant="secondary" className="gap-1.5">
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: STATUS_COLORS[item.status] }}
                    />
                    {STATUS_LABELS[item.status]}
                  </Badge>
                </button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  disabled={isRemoving}
                  onClick={() => handleRemove(item)}
                  aria-label={`Remove dependency on ${relatedTaskLabel(item)}`}
                >
                  {isRemoving ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <X className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
