"use client";

// F183 (AS-330 UI half): "New from template" — the board toolbar / list
// toolbar counterpart to <NewTaskDialog>'s "New Task" button (the closest
// thing this codebase has to a "quick-add menu" — neither view has a
// per-column quick-add row, so the toolbar is the one create-task entry
// point both views already share, per this feature's clarified
// "dependencies on existing code" answer). Picks a template by name, then
// calls the already-implemented `createTaskFromTemplate` (F182) directly —
// the created task lands at the top of the project's default ("todo")
// column, same as this codebase's other create paths.
//
// `templates` is server-fetched by the caller page and passed down as a
// typed prop (lib/queries/templates.ts's getWorkspaceTaskTemplateOptions)
// — this component never queries Supabase directly for its list, matching
// this feature's clarified data-shape answer.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LayoutTemplate } from "lucide-react";
import { toast } from "sonner";

import { createTaskFromTemplate } from "@/lib/actions/templates";
import { canWrite } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
import { Button } from "@/components/ui/button";
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
import type { TaskTemplatePickerOption } from "@/lib/queries/templates";

export function NewFromTemplateButton({
  projectId,
  templates,
}: {
  projectId: string;
  templates: TaskTemplatePickerOption[];
}) {
  const router = useRouter();
  // Same permissive-fallback convention NewTaskDialog already uses: no
  // provider in the tree is treated as "allowed" rather than blocking a
  // caller that hasn't wired membership context.
  const membership = useMembership();
  const canCreate = membership ? canWrite({ role: membership.role }) : true;
  const disabledTitle = canCreate
    ? undefined
    : "You don't have permission to create tasks.";

  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSelect(templateId: string, templateName: string) {
    startTransition(async () => {
      const result = await createTaskFromTemplate(templateId, projectId);
      if (result.ok) {
        toast.success(`Created "${result.data.title}" from "${templateName}".`);
        if (result.data.droppedAssigneeIds.length > 0) {
          toast.info(
            "Some assignees on that template are no longer members of this workspace and weren't applied.",
          );
        }
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  if (templates.length === 0) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            disabled={!canCreate}
            title={disabledTitle}
          >
            <LayoutTemplate className="size-4" aria-hidden="true" />
            New from template
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New from template</DialogTitle>
          <DialogDescription>
            Pick a template to create a new task pre-filled with its saved
            fields.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              disabled={isPending}
              onClick={() => handleSelect(template.id, template.name)}
              className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-mini hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="truncate">{template.name}</span>
              {isPending && (
                <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
              )}
            </button>
          ))}
        </div>
        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            }
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
