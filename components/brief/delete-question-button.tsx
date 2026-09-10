"use client";

// F053 (AS-109, AS-110, AS-111): lets a team member delete a brief
// question. Confirmation pattern mirrors DeleteWorkspaceDialog /
// ArchiveProjectDialog -- a Dialog with an explicit destructive confirm
// button, rather than a plain window.confirm, since this is a
// project-brief-editing action with permanent consequences for the
// questionnaire's shape.
//
// deleteBriefQuestion (lib/actions/brief.ts) only deletes the
// brief_questions row -- `brief_answers.question_id` has `on delete set
// null` and `question_prompt_snapshot` already captured the question's
// text at answer time (20261122010000_f044_brief_tables.sql), so any
// existing answer to this question survives the delete and keeps
// displaying its original prompt text (AS-110, AS-111). Nothing here
// needs to duplicate that -- it's a DB-level guarantee, not an
// application-level one.

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { deleteBriefQuestion } from "@/lib/actions/brief";
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

export function DeleteQuestionButton({ questionId }: { questionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteBriefQuestion(questionId);

      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }

      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="ghost" size="sm">
            <Trash2 className="size-4" aria-hidden="true" />
            Delete question
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this question?</DialogTitle>
          <DialogDescription>
            Existing answers will be preserved.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
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
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={handleDelete}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Deleting...
              </>
            ) : (
              "Delete question"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
