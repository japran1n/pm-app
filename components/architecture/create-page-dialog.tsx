"use client";

// Mission 20260910-182104, F010 (AS-001, AS-002, AS-031, AS-037): the
// "Add first page" / "Add page" dialog wired to `createPage`
// (lib/actions/architecture.ts). Smallest possible client boundary
// (tech-decisions.md convention), same shape as NewProjectDialog: a
// Client Component owning only the form state, calling the Server Action
// and refreshing on success.
//
// Slug: F011 (AS-013, AS-014, AS-015, AS-016) proposes a slug from the
// name via `slugify` and lets it be edited before save. Once the user
// manually edits the slug field, `slugEdited` flips true and the slug
// stops tracking further name changes (AS-015) -- it is frozen at
// whatever the user typed, including nested segments like
// "services/seo" (AS-016).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { createPage } from "@/lib/actions/architecture";
import { slugify } from "@/lib/utils/slugify";
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
} from "@/components/ui/dialog";

export function CreatePageDialog({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function resetAndClose() {
    setName("");
    setSlug("");
    setSlugEdited(false);
    setError(null);
    onOpenChange(false);
  }

  function handleNameChange(nextName: string) {
    setName(nextName);
    // AS-013/AS-015: keep proposing a slug from the name until the user
    // has manually edited the slug field; once edited, the slug is
    // frozen and no longer tracks the name.
    if (!slugEdited) {
      setSlug(slugify(nextName));
    }
  }

  function handleSlugChange(nextSlug: string) {
    setSlugEdited(true);
    setSlug(nextSlug);
  }

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    const trimmedSlug = slug.trim();

    startTransition(async () => {
      const result = await createPage(projectId, {
        name: trimmedName,
        slug: trimmedSlug,
        page_kind: "static",
      });

      if (result.ok) {
        toast.success(`${result.data.title} created.`);
        resetAndClose();
        router.refresh();
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  // AS-017: the "slug already exists" error comes back scoped to the slug
  // field specifically -- surface it inline next to that input instead of
  // (or in addition to) the generic error paragraph below the name field.
  const isSlugError =
    error !== null &&
    (error.toLowerCase().includes("slug") ||
      error.toLowerCase().includes("path"));

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetAndClose();
        } else {
          onOpenChange(true);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add page</DialogTitle>
          <DialogDescription>
            Adds a new column to this project&apos;s architecture board.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="page-name">Name</Label>
            <Input
              id="page-name"
              name="name"
              required
              autoFocus
              disabled={isPending}
              value={name}
              onChange={(changeEvent) => handleNameChange(changeEvent.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "page-name-error" : undefined}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="page-slug">Slug</Label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground" aria-hidden="true">
                /
              </span>
              <Input
                id="page-slug"
                name="slug"
                required
                disabled={isPending}
                value={slug}
                placeholder="e.g. services/seo"
                onChange={(changeEvent) => handleSlugChange(changeEvent.target.value)}
                aria-invalid={isSlugError ? true : undefined}
                aria-describedby={isSlugError ? "page-slug-error" : undefined}
              />
            </div>
            {isSlugError && (
              <p id="page-slug-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          {error && !isSlugError && (
            <p id="page-name-error" role="alert" className="text-sm text-destructive">
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
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                "Add page"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
