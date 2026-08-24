"use client";

// F229 (AS-426, AS-427): "save current filters as a view" — captures the
// list page's CURRENT URL search params (status/priority/assigneeId/sort,
// the same query-string keys lib/views/apply-view.ts's
// `parseViewSearchParams` already knows how to decode) into a
// `SavedViewConfig` and calls the real F228 `createSavedView` action.
// Deliberately reuses `parseViewSearchParams` rather than re-deriving its
// own filter-reading logic, per this repo's "one source of truth" rule.

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";

import { createSavedView } from "@/lib/actions/views";
import { parseViewSearchParams } from "@/lib/views/apply-view";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SaveViewDialog({
  workspaceId,
  projectId,
}: {
  workspaceId: string;
  projectId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"personal" | "shared">("personal");
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Give this view a name.");
      return;
    }

    // Never round-trip a `viewId` param from a currently-applied view into
    // the new view's own saved config -- it names the view being saved
    // FROM, not a filter to persist.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("viewId");
    const config = parseViewSearchParams(params);

    startTransition(async () => {
      const result = await createSavedView({
        workspaceId,
        projectId,
        name: trimmed,
        scope,
        viewType: "list",
        config,
      });
      if (result.ok) {
        toast.success(`Saved view "${result.data.name}".`);
        setOpen(false);
        setName("");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm">
            <Save className="size-4" aria-hidden="true" />
            Save view
          </Button>
        }
      />
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Save current filters as a view</DialogTitle>
            <DialogDescription>
              Saves the current filters, sort, and grouping so you (or, if
              shared, anyone with access to this project) can come back to
              them later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="saved-view-name">Name</Label>
              <Input
                id="saved-view-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="e.g. My open tasks"
                maxLength={80}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="saved-view-scope">Visibility</Label>
              <Select value={scope} onValueChange={(value) => setScope(value as "personal" | "shared")}>
                <SelectTrigger id="saved-view-scope" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Only me</SelectItem>
                  <SelectItem value="shared">Everyone with access to this project</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="ghost">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Save view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
