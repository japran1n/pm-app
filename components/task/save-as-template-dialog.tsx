"use client";

// F183 (AS-328 UI half): "Save as template" trigger — lives on the task
// detail Sheet's footer next to "Delete task" (the only other destructive/
// terminal action already in that footer), since neither the board nor
// list views had an existing context-menu convention to mirror (F180's
// "Duplicate" shipped as a Server Action only, with no UI wiring yet — see
// that feature's own handoff). Calls the already-implemented
// `saveTaskAsTemplate` (lib/actions/templates.ts, F182) directly; no new
// mutation logic here.
//
// Gated by `canWrite` (same viewer-is-read-only rule every other
// mutating control on this Sheet already re-checks client-side) — the
// server re-checks membership + canWrite itself, this is only the
// hide/disable half.

import { useState, useTransition } from "react";
import { Loader2, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";

import { saveTaskAsTemplate } from "@/lib/actions/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function SaveAsTemplateDialog({
  taskId,
  taskTitle,
  disabled = false,
  disabledTitle,
}: {
  taskId: string;
  taskTitle: string;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(taskTitle);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setName(taskTitle);
      setError(null);
    }
  }

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Template name is required.");
      return;
    }
    setError(null);

    startTransition(async () => {
      const result = await saveTaskAsTemplate(taskId, trimmed);
      if (result.ok) {
        toast.success(`Saved "${result.data.name}" as a template.`);
        setOpen(false);
      } else {
        // Failure handling (clarified spec): the dialog stays open with
        // the entered name intact and a plain-language error, so the
        // control remains actionable rather than silently reverting.
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            title={disabled ? disabledTitle : undefined}
          >
            <LayoutTemplate className="size-4" aria-hidden="true" />
            Save as template
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Saves this task&apos;s title, description, priority, checklist,
            estimate, tags, and assignees as a reusable template. This is a
            one-time snapshot — later edits to this task won&apos;t update
            the template.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="template-name">Template name</Label>
            <Input
              id="template-name"
              name="name"
              required
              disabled={isPending}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "template-name-error" : undefined}
            />
          </div>

          {error && (
            <p id="template-name-error" role="alert" className="text-mini text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="ghost" disabled={isPending}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Saving...
                </>
              ) : (
                "Save template"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
