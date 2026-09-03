"use client";

// F008 (missions/20260903-portal, M2 — Approvals): the single
// "Request client approval" dialog opened from three entry points — the
// task detail sheet, a project doc's header, and standalone from project
// settings for an external artifact URL (AS-019). One component rather
// than three, per the spec's own instruction ("a single component"); the
// three call sites each pass a different `subject` prop shape.
//
// AS-020's actual rejection happens server-side, in requestApproval
// (lib/actions/approvals.ts) — this dialog's own subject-type branching
// never lets a team member pick a task in the first place unless the
// caller already knows it (a task subject is only ever opened from that
// task's own detail sheet, which already renders its own
// ClientVisibilityToggle right next to this trigger), but the *authoritative*
// check is the server round trip, not this component.
//
// "Who will be asked": fetched via getDecisionOwnersForDialog
// (lib/actions/approvals.ts) when the dialog opens, and re-read whenever
// decisionType changes — mirrors task-detail-sheet.tsx's own
// "Server Action called from a useEffect" pattern for getProjectPhaseOptions.
// Submission is disabled (not just visually discouraged) when the chosen
// decision type has no owner — "an approval sent into a void is the
// failure this prevents" (spec's own words).

import { useEffect, useState, useTransition } from "react";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { requestApproval, getDecisionOwnersForDialog } from "@/lib/actions/approvals";
import type { ApprovalDecisionType, PortalDecisionOwner } from "@/lib/queries/approvals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { UserAvatar } from "@/components/user-avatar";

const DECISION_TYPES: { value: ApprovalDecisionType; label: string }[] = [
  { value: "content", label: "Content" },
  { value: "brand", label: "Brand" },
  { value: "technical", label: "Technical" },
  { value: "commercial", label: "Commercial" },
];

export type ApprovalDialogSubject =
  | { subjectType: "task"; subjectId: string; defaultTitle: string; defaultMessage: string | null; defaultDecisionType: ApprovalDecisionType }
  | { subjectType: "doc"; subjectId: string; defaultTitle: string }
  | { subjectType: "artifact" };

export function RequestApprovalDialog({
  projectId,
  subject,
  trigger,
  onRequested,
}: {
  projectId: string;
  subject: ApprovalDialogSubject;
  /** Rendered as the Dialog's trigger. A Button is the default so a caller
   * that doesn't need a custom trigger still gets a working one. */
  trigger?: React.ReactElement;
  /** Called after a successful submission, e.g. to close a parent sheet's
   * own local state or refresh a list. Optional — most callers just rely
   * on revalidatePath (requestApproval's own side effect). */
  onRequested?: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [artifactUrl, setArtifactUrl] = useState("");
  const [decisionType, setDecisionType] = useState<ApprovalDecisionType>("content");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [owners, setOwners] = useState<PortalDecisionOwner[] | null>(null);
  const [ownersError, setOwnersError] = useState(false);

  function resetForm() {
    setError(null);
    setArtifactUrl("");
    setDueAt("");
    if (subject.subjectType === "task") {
      setTitle(subject.defaultTitle);
      setMessage(subject.defaultMessage ?? "");
      setDecisionType(subject.defaultDecisionType);
    } else if (subject.subjectType === "doc") {
      setTitle(subject.defaultTitle);
      setMessage("");
      setDecisionType("content");
    } else {
      setTitle("");
      setMessage("");
      setDecisionType("content");
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      resetForm();
      setOwners(null);
      setOwnersError(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getDecisionOwnersForDialog(projectId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setOwners(result.data.owners);
      } else {
        setOwners([]);
        setOwnersError(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const currentOwner = owners?.find((owner) => owner.decisionType === decisionType) ?? null;
  const hasOwnerLoadFailed = ownersError;
  const ownersStillLoading = owners === null;
  const canSubmit = !ownersStillLoading && !hasOwnerLoadFailed && Boolean(currentOwner);

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);

    if (!canSubmit) {
      setError(
        `No one is set up to approve ${decisionType} decisions on this project yet. Set an owner in project settings first.`,
      );
      return;
    }

    startTransition(async () => {
      const result = await requestApproval({
        projectId,
        subjectType: subject.subjectType,
        subjectId: subject.subjectType === "artifact" ? null : subject.subjectId,
        artifactUrl: subject.subjectType === "artifact" ? artifactUrl : null,
        title,
        message: message || null,
        decisionType,
        dueAt: dueAt || null,
      });

      if (result.ok) {
        toast.success("Approval requested.");
        setOpen(false);
        onRequested?.(result.data.id);
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  const idPrefix = `request-approval-${subject.subjectType}`;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          trigger ?? (
            <Button type="button" variant="outline" size="sm">
              <Send className="size-4" aria-hidden="true" />
              Request client approval
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Request client approval</DialogTitle>
          <DialogDescription>
            {subject.subjectType === "artifact"
              ? "Send a link (a Figma frame, a sitemap, anything not in this app) to the client for a decision."
              : "Ask the client to approve or request changes on this."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-title`}>What is being approved</Label>
            <Input
              id={`${idPrefix}-title`}
              required
              disabled={isPending}
              value={title}
              onChange={(changeEvent) => setTitle(changeEvent.target.value)}
              maxLength={200}
            />
          </div>

          {subject.subjectType === "artifact" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-url`}>Link</Label>
              <Input
                id={`${idPrefix}-url`}
                type="url"
                required
                placeholder="https://www.figma.com/…"
                disabled={isPending}
                value={artifactUrl}
                onChange={(changeEvent) => setArtifactUrl(changeEvent.target.value)}
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-decision-type`}>Decision type</Label>
              <Select
                value={decisionType}
                onValueChange={(value) => {
                  if (typeof value === "string") {
                    setDecisionType(value as ApprovalDecisionType);
                  }
                }}
                disabled={isPending}
              >
                <SelectTrigger id={`${idPrefix}-decision-type`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DECISION_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${idPrefix}-due-at`}>Due date (optional)</Label>
              <Input
                id={`${idPrefix}-due-at`}
                type="date"
                disabled={isPending}
                value={dueAt}
                onChange={(changeEvent) => setDueAt(changeEvent.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${idPrefix}-message`}>Message to the client (optional)</Label>
            <Textarea
              id={`${idPrefix}-message`}
              disabled={isPending}
              value={message}
              onChange={(changeEvent) => setMessage(changeEvent.target.value)}
              rows={3}
            />
          </div>

          {/* AS-019 definition-of-done: "the dialog names the person who
              will be asked, in all four decision types." */}
          <div
            className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-sm"
            aria-live="polite"
          >
            {ownersStillLoading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                Checking who approves {decisionType} decisions…
              </span>
            ) : hasOwnerLoadFailed ? (
              <span className="text-destructive">
                Couldn&apos;t load this project&apos;s decision owners. Try again.
              </span>
            ) : currentOwner ? (
              <>
                <UserAvatar
                  person={{
                    id: currentOwner.userId,
                    name: currentOwner.name,
                    email: null,
                    avatarUrl: currentOwner.avatarUrl,
                  }}
                  className="size-6"
                />
                <span>
                  <span className="font-medium">
                    {currentOwner.name ?? "This person"}
                  </span>{" "}
                  will be asked to decide.
                </span>
              </>
            ) : (
              <span className="text-destructive">
                No one is set up to approve {decisionType} decisions on this
                project yet. Set an owner in project settings first.
              </span>
            )}
          </div>

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
            <Button type="submit" disabled={isPending || !canSubmit}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Sending...
                </>
              ) : (
                "Request approval"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
