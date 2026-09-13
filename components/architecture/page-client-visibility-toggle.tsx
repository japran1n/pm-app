"use client";

// F003 (missions/20260914-portal-simplify, AS-004, AS-005): "share this
// page with the client" control on an Architecture board page column.
// Mirrors components/task/client-visibility-toggle.tsx's optimistic
// flip/rollback convention exactly, for the same reason that toggle's own
// header gives -- a share control that lags behind the click invites a
// double-click, and a double-click here means accidentally publishing (or
// hiding) a whole page.
//
// Clarified spec: sharing a page offers to also share its sections. When
// the page has at least one live section and the team is turning sharing
// ON, an AlertDialog asks whether to share the sections too before the
// action runs -- turning sharing OFF never touches sections (hiding the
// page is enough to remove it, and its sections, from the portal Site
// map; unsharing intentionally does not throw away section-level choices
// made earlier).

import { useState, useTransition } from "react";
import { Eye, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";

import { setPageClientVisibility } from "@/lib/actions/architecture";
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
import type { BoardPage } from "@/lib/queries/architecture";

export function PageClientVisibilityToggle({ page }: { page: BoardPage }) {
  const serverValue = page.clientVisible ?? false;
  const [isShared, setIsShared] = useState(serverValue);
  const [isPending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [syncedPageId, setSyncedPageId] = useState(page.id);
  const [lastServerValue, setLastServerValue] = useState(serverValue);

  if (syncedPageId !== page.id) {
    setSyncedPageId(page.id);
    setLastServerValue(serverValue);
    setIsShared(serverValue);
  } else if (lastServerValue !== serverValue) {
    setLastServerValue(serverValue);
    setIsShared(serverValue);
  }

  function apply(next: boolean, includeSections: boolean) {
    setIsShared(next);

    startTransition(async () => {
      const result = await setPageClientVisibility(page.id, next, { includeSections });

      if (!result.ok) {
        setIsShared(!next);
        toast.error(result.error);
        return;
      }

      if (includeSections && result.data.sectionsShared > 0) {
        toast.success(
          `Shared with the client, including ${result.data.sectionsShared} section${
            result.data.sectionsShared === 1 ? "" : "s"
          }.`,
        );
      } else {
        toast.success(next ? "Shared with the client." : "Hidden from the client.");
      }
    });
  }

  function handleToggle() {
    const next = !isShared;

    // AS-004: only sharing (not unsharing) offers to also share sections,
    // and only when the page actually has any.
    if (next && page.sections.length > 0) {
      setConfirmOpen(true);
      return;
    }

    apply(next, false);
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleToggle}
        disabled={isPending}
        aria-pressed={isShared}
        aria-label={isShared ? "Hide page from client" : "Share page with client"}
        title={isShared ? "Visible to client" : "Internal only"}
        className={isShared ? "shrink-0 text-emerald-600" : "shrink-0"}
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : isShared ? (
          <Eye className="size-4" aria-hidden="true" />
        ) : (
          <Lock className="size-4" aria-hidden="true" />
        )}
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Share sections too?</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${page.title}" has ${page.sections.length} section${
                page.sections.length === 1 ? "" : "s"
              }. Share them with the client as well, or just the page?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setConfirmOpen(false);
                apply(true, false);
              }}
            >
              Page only
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                apply(true, true);
              }}
            >
              Share sections too
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
