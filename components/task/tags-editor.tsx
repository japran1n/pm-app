"use client";

// F041: task tags editor (AS-065, AS-066). Smallest-possible-client-boundary
// component, same convention as components/task/task-detail-sheet.tsx
// (F039) — the caller passes the current tag list down as a prop; this
// component only owns the interactive add/remove surface and calls
// `updateTaskTags` (lib/actions/tasks.ts) directly, same as
// TaskDetailSheet calling editTask/assignTask/deleteTask.
//
// AS-065: zero, one, or multiple tags — the list may be empty on mount.
// AS-066: removing the last tag calls updateTaskTags(taskId, []), which the
// server action writes as an empty array, never null — this component
// never has to special-case "no tags" as anything other than an empty
// array in its own local state.

import { useState } from "react";
import { useTransition } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import { updateTaskTags } from "@/lib/actions/tasks";
import { canTeamWrite, type WorkspaceRole } from "@/lib/auth/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TagsEditor({
  taskId,
  tags,
  currentUserRole,
}: {
  taskId: string;
  /** Current tag list for this task (may be empty — AS-065). */
  tags: string[];
  /** F135 (AS-231): threaded straight through from TaskDetailSheet's own
   * `currentUserRole` prop, same convention CommentList/TimeTracking/
   * AttachmentList already use — viewers/guests never see a usable
   * add/remove-tag control. Undefined (a caller that hasn't been updated,
   * e.g. an existing test) is treated as permissive. */
  currentUserRole?: WorkspaceRole;
}) {
  const canEditTags = currentUserRole
    ? canTeamWrite({ role: currentUserRole })
    : true;
  const disabledTitle = canEditTags
    ? undefined
    : "You don't have permission to edit tags.";
  const [localTags, setLocalTags] = useState(tags);
  // Tracks which task's tags are currently loaded into local state, so it
  // can be re-synced below without an Effect — same "adjust state during
  // render on prop change" convention as TaskDetailSheet's syncedTaskId.
  const [syncedTaskId, setSyncedTaskId] = useState(taskId);
  const [draft, setDraft] = useState("");
  const [isSaving, startSaveTransition] = useTransition();

  if (taskId !== syncedTaskId) {
    setSyncedTaskId(taskId);
    setLocalTags(tags);
    setDraft("");
  }

  function persist(nextTags: string[]) {
    const previousTags = localTags;
    setLocalTags(nextTags);
    startSaveTransition(async () => {
      const result = await updateTaskTags(taskId, nextTags);
      if (result.ok) {
        setLocalTags(result.data.tags);
      } else {
        // Revert optimistic update on failure.
        setLocalTags(previousTags);
        toast.error(result.error);
      }
    });
  }

  function handleAdd() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (localTags.includes(trimmed)) {
      setDraft("");
      return;
    }
    setDraft("");
    persist([...localTags, trimmed]);
  }

  function handleRemove(tagToRemove: string) {
    // AS-066: this can legitimately reduce localTags to an empty array —
    // that is a fully valid call, not a no-op or an error.
    persist(localTags.filter((tag) => tag !== tagToRemove));
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`task-tags-${taskId}`}>Tags</Label>
      <div className="flex flex-wrap gap-1.5">
        {localTags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tags yet.</p>
        ) : (
          localTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1 pr-1">
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                disabled={isSaving || !canEditTags}
                title={disabledTitle}
                onClick={() => handleRemove(tag)}
                className="rounded-full p-0.5 hover:bg-muted-foreground/20 disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Input
          id={`task-tags-${taskId}`}
          value={draft}
          disabled={isSaving || !canEditTags}
          placeholder="Add a tag"
          title={disabledTitle}
          onChange={(changeEvent) => setDraft(changeEvent.target.value)}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === "Enter") {
              keyEvent.preventDefault();
              handleAdd();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={isSaving || !draft.trim() || !canEditTags}
          title={disabledTitle}
          onClick={handleAdd}
        >
          <Plus className="size-4" aria-hidden="true" />
          Add
        </Button>
      </div>
    </div>
  );
}
