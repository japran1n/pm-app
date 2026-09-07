"use client";

// Out-of-office status note: the small settings-page form a member uses
// to set/clear their own note + optional "until" expiry date, scoped to
// the current workspace (workspace_members.status_note /
// status_note_until). Mirrors ProfileForm's own "optimistic value,
// revert-on-failure, sonner toast" convention -- smallest possible client
// boundary, the page above stays a Server Component for data loading.

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateStatusNote } from "@/lib/actions/status-note";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StatusNoteForm({
  workspaceId,
  statusNote: initialStatusNote,
  statusNoteUntil: initialStatusNoteUntil,
}: {
  workspaceId: string;
  statusNote: string | null;
  statusNoteUntil: string | null;
}) {
  const [savedNote, setSavedNote] = useState(initialStatusNote ?? "");
  const [savedUntil, setSavedUntil] = useState(initialStatusNoteUntil ?? "");
  const [note, setNote] = useState(initialStatusNote ?? "");
  const [until, setUntil] = useState(initialStatusNoteUntil ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    const trimmedNote = note.trim();
    startTransition(async () => {
      const result = await updateStatusNote({
        workspaceId,
        note: trimmedNote || null,
        until: trimmedNote ? until || null : null,
      });
      if (!result.ok) {
        toast.error(result.error);
        setNote(savedNote);
        setUntil(savedUntil);
        return;
      }
      setSavedNote(result.data.note ?? "");
      setSavedUntil(result.data.until ?? "");
      setNote(result.data.note ?? "");
      setUntil(result.data.until ?? "");
      toast.success(trimmedNote ? "Status note updated." : "Status note cleared.");
    });
  }

  const hasChanges = note.trim() !== savedNote.trim() || until !== savedUntil;

  return (
    <div className="flex flex-col gap-3" data-testid="status-note-form">
      <div className="flex flex-col gap-1">
        <Label htmlFor="status-note">Status note</Label>
        <Input
          id="status-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Vraćam se ponedeljak"
          maxLength={140}
          disabled={isPending}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="status-note-until">Show until (optional)</Label>
        <Input
          id="status-note-until"
          type="date"
          value={until}
          onChange={(e) => setUntil(e.target.value)}
          disabled={isPending || note.trim().length === 0}
        />
      </div>
      <div>
        <Button
          type="button"
          size="sm"
          onClick={handleSave}
          disabled={isPending || !hasChanges}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            "Save"
          )}
        </Button>
      </div>
    </div>
  );
}
