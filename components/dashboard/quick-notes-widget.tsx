"use client";

// Quick notes: a compact, always-visible "don't forget" list on the
// workspace dashboard. Lighter than a personal to-do (personal-todo-list.tsx)
// — no realtime wiring, since this widget only ever reflects the current
// user's own writes, never another actor's. Optionally references a task or
// project, rendered as a small clickable chip when present.

import { useState, useTransition } from "react";
import Link from "next/link";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";

import {
  createQuickNote,
  deleteQuickNote,
  toggleQuickNote,
} from "@/lib/actions/quick-notes";
import type { QuickNote } from "@/lib/queries/quick-notes";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

export function QuickNotesWidget({
  workspaceId,
  workspaceSlug,
  initialNotes,
}: {
  workspaceId: string;
  workspaceSlug: string;
  initialNotes: QuickNote[];
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [newText, setNewText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, startTransition] = useTransition();

  async function handleCreate() {
    const text = newText.trim();
    if (!text || isSubmitting) return;
    setIsSubmitting(true);

    const tempId = `temp-${Date.now()}`;
    const optimistic: QuickNote = {
      id: tempId,
      text,
      isDone: false,
      createdAt: new Date().toISOString(),
      taskId: null,
      taskKey: null,
      taskTitle: null,
      projectId: null,
      projectName: null,
    };
    setNotes((current) => [optimistic, ...current]);
    setNewText("");

    const result = await createQuickNote({ workspaceId, text });
    setIsSubmitting(false);

    if (!result.ok) {
      setNotes((current) => current.filter((n) => n.id !== tempId));
      toast.error(result.error);
      return;
    }
    // Re-fetch is left to a future navigation/refresh — the optimistic row
    // stays displayed as-is (it's already correct for a note without a
    // task/project link, which is the only kind this input can create).
  }

  function handleToggle(note: QuickNote) {
    const nextIsDone = !note.isDone;
    setNotes((current) =>
      current.map((n) => (n.id === note.id ? { ...n, isDone: nextIsDone } : n)),
    );
    startTransition(async () => {
      const result = await toggleQuickNote({ noteId: note.id, isDone: nextIsDone });
      if (!result.ok) {
        setNotes((current) =>
          current.map((n) => (n.id === note.id ? { ...n, isDone: note.isDone } : n)),
        );
        toast.error(result.error);
      }
    });
  }

  async function handleDelete(noteId: string) {
    const previous = notes;
    setNotes((current) => current.filter((n) => n.id !== noteId));
    const result = await deleteQuickNote({ noteId });
    if (!result.ok) {
      setNotes(previous);
      toast.error(result.error);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
      <h2 className="text-sm font-medium">Quick notes</h2>
      <p className="text-xs text-muted-foreground">
        Fast personal reminders — lighter than a task, visible only to you.
      </p>

      <ul className="flex flex-col gap-1">
        {notes.map((note) => (
          <li key={note.id} className="group flex items-center gap-2">
            <Checkbox
              checked={note.isDone}
              onCheckedChange={() => handleToggle(note)}
              aria-label={`Mark "${note.text}" ${note.isDone ? "not done" : "done"}`}
            />
            <div className="flex flex-1 flex-col">
              <span
                className={
                  note.isDone
                    ? "text-sm text-muted-foreground line-through"
                    : "text-sm"
                }
              >
                {note.text}
              </span>
              {note.taskId && (
                <Link
                  href={`/w/${workspaceSlug}/t/${note.taskKey ?? note.taskId}`}
                  className="text-xs text-primary hover:underline"
                >
                  on task: {note.taskTitle ?? note.taskKey}
                </Link>
              )}
              {!note.taskId && note.projectId && (
                <Link
                  href={`/w/${workspaceSlug}/projects/${note.projectId}/list`}
                  className="text-xs text-primary hover:underline"
                >
                  on project: {note.projectName ?? "project"}
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => handleDelete(note.id)}
              aria-label={`Delete "${note.text}"`}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </li>
        ))}
        {notes.length === 0 && (
          <li className="text-sm text-muted-foreground">Nothing here yet.</li>
        )}
      </ul>

      <div className="flex items-center gap-2 pt-1">
        <Input
          value={newText}
          onChange={(event) => setNewText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleCreate();
            }
          }}
          placeholder="Jot a quick note..."
          disabled={isSubmitting}
          className="h-8"
          aria-label="New quick note"
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={handleCreate}
          disabled={isSubmitting || !newText.trim()}
          aria-label="Add quick note"
        >
          <Plus className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
