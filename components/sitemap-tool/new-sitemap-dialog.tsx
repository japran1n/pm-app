"use client";

// Standalone Sitemap tool, Phase 2: "New sitemap" dialog on the list page
// (/w/[workspaceSlug]/tools/sitemap). Smallest possible client boundary,
// same pattern as components/new-project-dialog.tsx -- the list page
// itself stays a Server Component. On success, navigates straight into
// the new sitemap's editor rather than just refreshing the list, per the
// clarified spec ("On success navigates to the new sitemap's editor").

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createSitemap } from "@/lib/actions/sitemaps";
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

export function NewSitemapDialog({
  workspaceId,
  workspaceSlug,
}: {
  workspaceId: string;
  workspaceSlug: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetAndClose() {
    setName("");
    setError(null);
    setOpen(false);
  }

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createSitemap(workspaceId, name);

      if (result.ok) {
        toast.success("Sitemap created.");
        resetAndClose();
        router.push(`/w/${workspaceSlug}/tools/sitemap/${result.data.id}`);
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetAndClose();
        } else {
          setOpen(true);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button className="gap-1.5">
            <Plus className="size-4" aria-hidden="true" />
            New sitemap
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New sitemap</DialogTitle>
          <DialogDescription>
            Give it a name — you can add pages once it&apos;s created.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="sitemap-name">Name</Label>
            <Input
              id="sitemap-name"
              name="name"
              required
              disabled={isPending}
              value={name}
              onChange={(changeEvent) => setName(changeEvent.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "sitemap-name-error" : undefined}
            />
            {error && (
              <p id="sitemap-name-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="ghost" disabled={isPending}>
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                "Create"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
