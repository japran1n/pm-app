"use client";

// F028 (AS-029, AS-037): edit affordance for a project's name, description,
// start date, and end date. Added to the project list page's card (F027)
// rather than a dedicated project detail page, since that page doesn't
// exist yet (lands F030) — matches the feature's own scope note. Mirrors
// components/new-project-dialog.tsx's smallest-possible-client-boundary
// pattern, paired with F028's `editProject` Server Action.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { editProject } from "@/lib/actions/projects";
import { PROJECT_ICON_ALLOWLIST } from "@/lib/validation/project-icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
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

export function EditProjectDialog({
  workspaceId,
  project,
  // Ad-hoc "Projects page card redesign": see the matching comment in
  // SaveProjectAsTemplateDialog — lets the "..." hover menu wrapper lift
  // this dialog's open state into a DropdownMenuItem-driven controlled
  // value instead of this component's own trigger button.
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  hideTrigger = false,
}: {
  workspaceId: string;
  project: {
    id: string;
    name: string;
    description: string | null;
    startDate: string | null;
    endDate: string | null;
    icon?: string | null;
  };
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideTrigger?: boolean;
}) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [startDate, setStartDate] = useState(project.startDate ?? "");
  const [endDate, setEndDate] = useState(project.endDate ?? "");
  const [icon, setIcon] = useState<string | null>(project.icon ?? null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(nextOpen: boolean) {
    setUncontrolledOpen(nextOpen);
    controlledOnOpenChange?.(nextOpen);
    if (nextOpen) {
      // Reset to the latest known values every time the dialog opens, in
      // case a previous edit (or another viewer's edit + router.refresh())
      // changed the underlying project since this dialog last closed.
      setName(project.name);
      setDescription(project.description ?? "");
      setStartDate(project.startDate ?? "");
      setEndDate(project.endDate ?? "");
      setIcon(project.icon ?? null);
      setError(null);
    }
  }

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await editProject(project.id, workspaceId, {
        name,
        description: description || null,
        startDate: startDate || null,
        endDate: endDate || null,
        icon,
      });

      if (result.ok) {
        toast.success(`${result.data.name} updated.`);
        handleOpenChange(false);
        router.refresh();
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!hideTrigger && (
        <DialogTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              aria-label={`Edit ${project.name}`}
            >
              <Pencil className="size-4" aria-hidden="true" />
            </Button>
          }
        />
      )}
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
          <DialogDescription>
            Update this project&apos;s details.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`edit-project-name-${project.id}`}>Name</Label>
            <Input
              id={`edit-project-name-${project.id}`}
              name="name"
              required
              disabled={isPending}
              value={name}
              onChange={(changeEvent) => setName(changeEvent.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `edit-project-error-${project.id}` : undefined}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`edit-project-description-${project.id}`}>
              Description (optional)
            </Label>
            <Textarea
              id={`edit-project-description-${project.id}`}
              name="description"
              disabled={isPending}
              value={description}
              onChange={(changeEvent) =>
                setDescription(changeEvent.target.value)
              }
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label id={`edit-project-icon-label-${project.id}`}>
              Icon (optional)
            </Label>
            <div
              role="group"
              aria-labelledby={`edit-project-icon-label-${project.id}`}
              className="grid grid-cols-4 gap-1 sm:grid-cols-8"
            >
              <button
                type="button"
                disabled={isPending}
                aria-pressed={icon === null}
                aria-label="No icon"
                onClick={() => setIcon(null)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md border text-xs text-muted-foreground hover:bg-accent",
                  icon === null && "border-primary bg-primary/10",
                )}
              >
                None
              </button>
              {PROJECT_ICON_ALLOWLIST.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={isPending}
                  aria-pressed={icon === emoji}
                  aria-label={`Use ${emoji} as the project icon`}
                  onClick={() => setIcon(emoji)}
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md border text-base hover:bg-accent",
                    icon === emoji && "border-primary bg-primary/10",
                  )}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`edit-project-start-date-${project.id}`}>
                Start date (optional)
              </Label>
              <Input
                id={`edit-project-start-date-${project.id}`}
                name="startDate"
                type="date"
                disabled={isPending}
                value={startDate}
                onChange={(changeEvent) => setStartDate(changeEvent.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`edit-project-end-date-${project.id}`}>
                End date (optional)
              </Label>
              <Input
                id={`edit-project-end-date-${project.id}`}
                name="endDate"
                type="date"
                disabled={isPending}
                value={endDate}
                onChange={(changeEvent) => setEndDate(changeEvent.target.value)}
              />
            </div>
          </div>
          {error && (
            <p
              id={`edit-project-error-${project.id}`}
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
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
