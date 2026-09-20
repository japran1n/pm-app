"use client";

// Standalone Sitemap tool, Phase 2: rename dialog opened from the editor's
// top-bar title (SitemapEditor). Same controlled-dialog shape as the list
// page's own rename dialog (sitemap-card.tsx) -- kept as a separate
// component here since the editor's trigger (clicking the title) isn't a
// dropdown item.

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { renameSitemap } from "@/lib/actions/sitemaps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function RenameSitemapDialog({
  open,
  onOpenChange,
  sitemapId,
  initialName,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sitemapId: string;
  initialName: string;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    startTransition(async () => {
      const result = await renameSitemap(sitemapId, name);
      if (result.ok) {
        toast.success("Sitemap renamed.");
        onOpenChange(false);
        onRenamed();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setName(initialName);
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename sitemap</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            value={name}
            disabled={isPending}
            onChange={(changeEvent) => setName(changeEvent.target.value)}
          />
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="ghost" disabled={isPending}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
