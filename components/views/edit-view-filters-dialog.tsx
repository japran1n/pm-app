"use client";

// Follow-up (advanced filtering, partial -> UI): the "Edit filters" entry
// point for an existing saved view, reachable from the view row in
// <ViewSwitcher>. Loads that view's current `config.filters` into
// <FilterBuilder> and, on Save, writes the whole config back via the
// existing `updateSavedView` action (same authorization boundary that
// action already enforces -- owner, or an admin managing a shared view;
// this component does not re-derive that check, it just shows the
// server's error toast if rejected).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { updateSavedView } from "@/lib/actions/views";
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
import { FilterBuilder, type FilterFieldOption } from "@/components/views/filter-builder";
import type { FilterGroup, SavedViewConfig } from "@/lib/validation/views";
import { resolveEffectiveFilterGroup } from "@/lib/validation/views";

export function EditViewFiltersDialog({
  viewId,
  viewName,
  config,
  fieldOptions,
}: {
  viewId: string;
  viewName: string;
  config: SavedViewConfig;
  fieldOptions: FilterFieldOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(() => resolveEffectiveFilterGroup(config));
  const [isPending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next) {
      // Re-seed from the latest saved config every time the dialog opens,
      // so a stale local edit from a previous open (that was cancelled,
      // not saved) never leaks into the next session.
      setFilterGroup(resolveEffectiveFilterGroup(config));
    }
    setOpen(next);
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateSavedView({
        viewId,
        // `filters` is left empty -- `filterGroup` is the source of truth
        // once a view has been through this dialog; `resolveEffectiveFilterGroup`
        // prefers it over the legacy flat array on every future read.
        config: { filters: [], filterGroup, sort: config.sort, groupBy: config.groupBy },
      });
      if (result.ok) {
        toast.success(`Updated filters for "${viewName}".`);
        setOpen(false);
        router.refresh();
      } else {
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
            className="size-7 shrink-0"
            aria-label={`Edit filters for "${viewName}"`}
            title="Edit filters"
            onClick={(event) => event.stopPropagation()}
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit filters &mdash; {viewName}</DialogTitle>
          <DialogDescription>
            Choose whether a group must match all (AND) or any (OR) of its conditions.
            Add a group to nest AND/OR logic; choose &quot;is any of&quot; on a condition
            to match several values at once.
          </DialogDescription>
        </DialogHeader>
        <FilterBuilder filterGroup={filterGroup} onChange={setFilterGroup} fieldOptions={fieldOptions} />
        <DialogFooter>
          <DialogClose
            render={
              <Button type="button" variant="outline">
                Cancel
              </Button>
            }
          />
          <Button type="button" onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            Save filters
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
