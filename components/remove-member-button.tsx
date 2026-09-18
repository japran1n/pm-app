"use client";

// F020 (AS-016/AS-017/AS-018): owner/admin-only control to remove an
// active member. Uses shadcn AlertDialog for confirmation instead of
// window.confirm.
//
// P2-25: before confirming, the dialog now fetches how many tasks are
// currently assigned to the member and offers an optional reassign-to
// dropdown so those tasks aren't left dangling.

import { useState, useTransition, useEffect } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";

import { removeMember } from "@/lib/actions/workspaces";
import { getAssignedTaskCount } from "@/lib/actions/members";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type ReassignCandidate = {
  userId: string;
  label: string;
};

export function RemoveMemberButton({
  workspaceId,
  workspaceMemberId,
  memberLabel,
  userId,
  otherMembers = [],
}: {
  workspaceId: string;
  workspaceMemberId: string;
  memberLabel: string;
  /** The auth.users id of the member being removed — used to count their
   *  assigned tasks. Optional: when absent the task-count section is hidden. */
  userId?: string;
  /** Other active workspace members who can receive reassigned tasks. */
  otherMembers?: ReassignCandidate[];
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [reassignTo, setReassignTo] = useState<string>("");
  const [taskCount, setTaskCount] = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  // Fetch the task count once when the dialog opens (only if we have
  // a userId to look up; invited-but-not-accepted members have no user_id).
  // FIX (react-hooks/set-state-in-effect): resetting countLoading/taskCount/
  // reassignTo for a fresh open used to happen synchronously at the top of
  // this effect. That reset is really part of the user-triggered "open the
  // dialog" action, not a reaction to a committed render, so it now runs in
  // the trigger button's onClick handler below instead — this effect only
  // performs the actual fetch, and only ever calls setState from inside the
  // async `.then` callback.
  useEffect(() => {
    if (!open || !userId) return;

    let cancelled = false;

    getAssignedTaskCount(workspaceId, userId).then((result) => {
      if (!cancelled) {
        setTaskCount(result.count);
        setCountLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open, userId, workspaceId]);

  function handleConfirm() {
    startTransition(async () => {
      const result = await removeMember(
        workspaceId,
        workspaceMemberId,
        reassignTo || undefined,
      );
      if (result.ok) {
        const count = result.assignedTaskCount ?? 0;
        if (count > 0 && reassignTo) {
          const reassignLabel =
            otherMembers.find((m) => m.userId === reassignTo)?.label ??
            "another member";
          toast.success(
            `${memberLabel} removed. ${count} task${count === 1 ? "" : "s"} reassigned to ${reassignLabel}.`,
          );
        } else if (count > 0) {
          toast.success(
            `${memberLabel} removed. ${count} task${count === 1 ? "" : "s"} unassigned.`,
          );
        } else {
          toast.success(`${memberLabel} removed from the workspace.`);
        }
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  const hasTaskCount = taskCount !== null && taskCount > 0;
  const canReassign = hasTaskCount && otherMembers.length > 0;

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={isPending}
        onClick={() => {
          if (userId) {
            setCountLoading(true);
            setTaskCount(null);
          }
          setReassignTo("");
          setOpen(true);
        }}
        aria-label={`Remove ${memberLabel}`}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <X className="size-4" aria-hidden="true" />
        )}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member</AlertDialogTitle>
            <AlertDialogDescription className="sr-only">
              Remove {memberLabel} from this workspace
            </AlertDialogDescription>
            <div className="flex flex-col gap-3 text-sm">
                <p className="text-muted-foreground">
                  Remove <strong className="text-foreground">{memberLabel}</strong> from this workspace?
                  They will lose access immediately.
                </p>

                {/* P2-25: task-count preview + reassign picker */}
                {userId && (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm">
                    {countLoading ? (
                      <span className="text-muted-foreground">
                        Checking assigned tasks…
                      </span>
                    ) : taskCount === 0 ? (
                      <span className="text-muted-foreground">
                        This member has no assigned tasks.
                      </span>
                    ) : hasTaskCount ? (
                      <div className="flex flex-col gap-2">
                        <p>
                          This member has{" "}
                          <strong>
                            {taskCount} assigned task
                            {taskCount === 1 ? "" : "s"}
                          </strong>
                          .
                        </p>
                        {canReassign ? (
                          <>
                            <p className="text-muted-foreground">
                              Reassign to (optional):
                            </p>
                            <Select
                              value={reassignTo}
                              onValueChange={(v) => setReassignTo(v ?? "")}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Leave unassigned" />
                              </SelectTrigger>
                              <SelectContent>
                                {otherMembers.map((m) => (
                                  <SelectItem key={m.userId} value={m.userId}>
                                    {m.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {!reassignTo && (
                              <p className="text-xs text-muted-foreground">
                                If no reassignee is selected, tasks will be
                                unassigned.
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-muted-foreground">
                            Tasks will be unassigned.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending || countLoading}
              onClick={(e) => {
                e.preventDefault();
                handleConfirm();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Removing…
                </>
              ) : (
                "Remove"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
