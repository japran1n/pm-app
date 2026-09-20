"use client";

// Standalone Sitemap tool, Phase 2: one card on the sitemap list page.
// Mirrors components/projects/project-card-actions.tsx's shape (a
// hover-revealed "..." menu with Rename/Duplicate/Archive), collapsed
// into one file since a sitemap card has far fewer fields than a project
// card. Clicking the card body (not the menu) navigates into the editor.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { MoreHorizontal, Network } from "lucide-react";
import { toast } from "sonner";

import { renameSitemap, duplicateSitemap, archiveSitemap } from "@/lib/actions/sitemaps";
import type { SitemapListItem } from "@/lib/queries/sitemaps";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function SitemapCard({
  workspaceSlug,
  sitemap,
  shared,
}: {
  workspaceSlug: string;
  sitemap: SitemapListItem;
  shared: boolean;
}) {
  const router = useRouter();
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState(sitemap.name);
  const [isPending, startTransition] = useTransition();

  function handleRename(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    startTransition(async () => {
      const result = await renameSitemap(sitemap.id, name);
      if (result.ok) {
        toast.success("Sitemap renamed.");
        setRenameOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleDuplicate() {
    startTransition(async () => {
      const result = await duplicateSitemap(sitemap.id);
      if (result.ok) {
        toast.success("Sitemap duplicated.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleArchive() {
    startTransition(async () => {
      const result = await archiveSitemap(sitemap.id);
      if (result.ok) {
        toast.success("Sitemap archived.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="group/card relative flex flex-col gap-2 rounded-md border border-border bg-card p-4 shadow-xs transition-colors hover:border-border-control-hover">
      <Link
        href={`/w/${workspaceSlug}/tools/sitemap/${sitemap.id}`}
        className="flex flex-col gap-2 outline-none"
      >
        <div className="flex items-center gap-2.5 pr-8">
          <Network className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate text-sm font-medium text-foreground">{sitemap.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={shared ? "success" : "secondary"}>
            {shared ? "Shared" : "Not shared"}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">
            Updated {new Date(sitemap.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="absolute top-3 right-3 rounded-md border border-transparent p-1.5 opacity-0 outline-none transition-opacity duration-200 hover:border-border hover:bg-muted/50 focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 data-[popup-open]:opacity-100"
          aria-label={`More actions for ${sitemap.name}`}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setRenameOpen(true)}>Rename</DropdownMenuItem>
          <DropdownMenuItem onClick={handleDuplicate} disabled={isPending}>
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={handleArchive} disabled={isPending}>
            Archive
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename sitemap</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleRename} className="flex flex-col gap-4">
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
    </div>
  );
}
