"use client";

// F184: "Save as template" trigger for a PROJECT (the project-scope
// counterpart to F183's components/task/save-as-template-dialog.tsx).
// Lives on the projects list card, next to Edit/Archive — the closest
// existing per-project action row this codebase has (mirrors F183's own
// "no existing context-menu convention to mirror, use the nearest
// existing action row" decision). Calls the already-implemented
// `saveProjectAsTemplate` (lib/actions/templates.ts) directly.
//
// Gated by `canWrite` (same viewer-is-read-only rule every other
// mutating control already re-checks client-side) — the server
// re-checks membership + canWrite itself, this is only the hide/disable
// half.

import { useState, useTransition } from "react";
import { Loader2, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";

import { saveProjectAsTemplate } from "@/lib/actions/templates";
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

export function SaveProjectAsTemplateDialog({
  projectId,
  projectName,
  disabled = false,
  disabledTitle,
}: {
  projectId: string;
  projectName: string;
  disabled?: boolean;
  disabledTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(projectName);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setName(projectName);
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
      const result = await saveProjectAsTemplate(projectId, trimmed);
      if (result.ok) {
        toast.success(
          `Saved "${result.data.name}" as a template with ${result.data.taskCount} task${
            result.data.taskCount === 1 ? "" : "s"
          }.`,
        );
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
            variant="ghost"
            size="icon"
            disabled={disabled}
            title={disabled ? disabledTitle : "Save as template"}
            aria-label="Save as template"
          >
            <LayoutTemplate className="size-4" aria-hidden="true" />
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save as template</DialogTitle>
          <DialogDescription>
            Saves this project&apos;s current tasks (title, description,
            priority, checklist, estimate, tags) as a reusable project
            template. This is a one-time snapshot — later changes to this
            project won&apos;t update the template.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-template-name">Template name</Label>
            <Input
              id="project-template-name"
              name="name"
              required
              disabled={isPending}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={
                error ? "project-template-name-error" : undefined
              }
            />
          </div>

          {error && (
            <p
              id="project-template-name-error"
              role="alert"
              className="text-sm text-destructive"
            >
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
