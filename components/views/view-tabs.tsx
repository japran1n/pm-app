"use client";

// F401 ("views as tabs"): a horizontal row of a project's SHARED list
// views — "Setup / Content / Design / Dev / QA / Launch", clicked instead
// of picked from the <ViewSwitcher> dropdown. This adds no new
// filter-application logic: clicking a tab navigates to the exact same
// `?viewId=<id>` URL <ViewSwitcher> already produces, which the List page
// (app/(workspace)/.../list/page.tsx) already resolves via
// getSavedView + applyViewConfig (F229) — that mechanism was already
// built and tested; this is a second, more visible way to reach it.
//
// Deliberately shows only `scope: "shared"` views: a personal view is a
// private filter shortcut for one person, not a team-wide navigation
// structure, so it stays in the dropdown rather than cluttering a tab row
// everyone on the project sees. Creating a tab is done via the existing
// "Save view" dialog (components/views/save-view-dialog.tsx) with its
// scope set to "shared" — this component intentionally adds no second
// create affordance for the same action.
//
// Reordering (two arrow buttons, not drag-and-drop, matching this
// project's existing StatusManager/StatusTemplateManager convention) is
// available to whoever can edit a shared view — the SAME per-view
// authorization `updateSavedView` already enforces server-side
// (authorizeViewMutation: the view's own owner, or a workspace admin).
// This component doesn't re-derive that rule; it just calls the action
// and shows the error toast if the server rejects it.

import { useRouter, usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { toast } from "sonner";

import { updateSavedView } from "@/lib/actions/views";
import { calculatePosition } from "@/lib/board/position";
import type { SavedViewListItem } from "@/lib/queries/views";
import { cn } from "@/lib/utils";
import { canManageProject } from "@/lib/auth/permissions";
import { useMembership } from "@/components/auth/membership-provider";
// Follow-up (drag-and-drop view membership): each tab doubles as a drop
// target for a task row dragged from the table below (TaskDragHandle,
// components/views/view-drop-context.tsx) -- dropping a task here calls
// the same addTaskToView the "Add to view" dropdown menu already uses.
import { ViewDropTab } from "@/components/views/view-drop-context";

export function ViewTabs({
  views,
  activeViewId,
}: {
  views: SavedViewListItem[];
  activeViewId?: string;
}) {
  // Reorder controls are shown to a workspace owner/admin — the same
  // "manages shared team structure" gate this project already uses for
  // status templates and board columns tonight. A plain member who owns
  // one of these shared views can still reorder it by calling
  // updateSavedView directly (the server-side authorizeViewMutation check
  // is the real boundary, unchanged by this UI-only gate) — they just
  // don't see the hover arrows for tabs they don't manage, a minor UX gap
  // rather than a missing permission check.
  const membership = useMembership();
  const canManage = membership ? canManageProject({ role: membership.role }) : false;
  const router = useRouter();
  const pathname = usePathname();

  const tabs = views
    .filter((view) => view.scope === "shared")
    .sort((a, b) => a.position - b.position);

  if (tabs.length === 0) return null;

  function openTab(viewId: string) {
    router.push(`${pathname}?viewId=${viewId}`);
  }

  async function move(index: number, direction: "left" | "right") {
    const swapWith = direction === "left" ? index - 1 : index + 1;
    if (swapWith < 0 || swapWith >= tabs.length) return;

    // BUGFIX: the "move right" branch previously used `tabs[index]` (the
    // tab's OWN current position) as `before` instead of `tabs[swapWith]`
    // (the tab it's swapping past). That computed a midpoint between the
    // tab's old position and the one two slots ahead, which could still
    // land BEFORE `tabs[swapWith]`'s position for non-evenly-spaced
    // fractional positions -- silently failing to move the tab at all
    // (or even reordering it wrong) instead of throwing, which is why it
    // slipped past manual testing. Both branches now consistently use
    // "the tab currently occupying the slot we're moving into" as
    // `before`/`after`.
    const before = direction === "left" ? tabs[swapWith - 1] : tabs[swapWith];
    const after = direction === "left" ? tabs[swapWith] : tabs[swapWith + 1];
    const newPosition = calculatePosition(
      before?.position ?? null,
      after?.position ?? null,
    );

    const result = await updateSavedView({ viewId: tabs[index].id, position: newPosition });
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div
      role="tablist"
      aria-label="Saved views"
      className="flex items-center gap-1 overflow-x-auto border-b border-border"
    >
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeViewId;
        return (
          <ViewDropTab key={tab.id} viewId={tab.id} viewName={tab.name}>
          <div className="group flex items-center">
            {canManage && index > 0 && (
              <button
                type="button"
                onClick={() => move(index, "left")}
                aria-label={`Move "${tab.name}" earlier`}
                className="hidden size-5 shrink-0 items-center justify-center text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 sm:flex"
              >
                <ArrowLeft className="size-3" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => openTab(tab.id)}
              className={cn(
                "shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.name}
            </button>
            {canManage && index < tabs.length - 1 && (
              <button
                type="button"
                onClick={() => move(index, "right")}
                aria-label={`Move "${tab.name}" later`}
                className="hidden size-5 shrink-0 items-center justify-center text-muted-foreground opacity-0 hover:text-foreground group-hover:opacity-100 sm:flex"
              >
                <ArrowRight className="size-3" aria-hidden="true" />
              </button>
            )}
          </div>
          </ViewDropTab>
        );
      })}
    </div>
  );
}
