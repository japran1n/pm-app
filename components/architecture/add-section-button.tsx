"use client";

// Mission 20260910-182104, F013 (AS-003, AS-029, AS-038): the "Add section"
// control that lives inside each page column's header (F006 left the
// placeholder slot at PageColumn.tsx). Same smallest-possible-client-
// boundary pattern as CreatePageDialog: a Client Component owning only its
// own trigger/input state, calling the createSection Server Action and
// refreshing on success.
//
// AS-029: renders as a control inside the page column (not a dialog) --
// clicking "Add section" swaps the trigger for an inline text input.
// Enter or the checkmark submits; Escape cancels back to the trigger.
// AS-040 (naming assertion): submitting an empty/whitespace-only name is a
// no-op -- the input simply stays open, matching createSectionSchema's own
// "non-empty after trim" rule rather than duplicating it silently.
import { useRef, useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";

import { useArchitectureActions } from "@/lib/architecture/actions-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddSectionButton({
  pageTaskId,
}: {
  pageTaskId: string;
}) {
  const { createSection, readOnly } = useArchitectureActions();
  const router = useRouter();
  // The board route is scoped to a single project
  // (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/architecture),
  // so the project id is read from the route params rather than threaded
  // as a prop through ArchitectureBoard -> PageColumn -- avoids widening
  // those components' public contracts just for this one action's second
  // argument.
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setTitle("");
    setIsOpen(false);
  }

  function submit() {
    const trimmedTitle = title.trim();

    // AS-040: empty name is a no-op.
    if (trimmedTitle.length === 0) {
      return;
    }

    startTransition(async () => {
      const result = await createSection(pageTaskId, projectId, trimmedTitle);

      if (result.success) {
        reset();
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong. Please try again in a moment.");
      }
    });
  }

  if (readOnly) {
    return null;
  }

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit justify-start gap-1.5 text-xs text-muted-foreground"
        onClick={() => {
          setIsOpen(true);
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        <Plus className="size-3.5" aria-hidden="true" />
        Add section
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        ref={inputRef}
        aria-label="Section name"
        placeholder="Section name"
        value={title}
        disabled={isPending}
        className="h-8 text-sm"
        onChange={(changeEvent) => setTitle(changeEvent.target.value)}
        onKeyDown={(keyEvent) => {
          if (keyEvent.key === "Enter") {
            keyEvent.preventDefault();
            submit();
          } else if (keyEvent.key === "Escape") {
            keyEvent.preventDefault();
            reset();
          }
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        disabled={isPending}
        aria-label="Add section"
        onClick={submit}
      >
        <Check className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
