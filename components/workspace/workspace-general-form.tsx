"use client";

// F136 (AS-239, AS-240) + F137 (AS-241, AS-242): the settings page's
// interactive "General" section — workspace name and slug, each editable
// and saved independently through their own Server Action
// (`renameWorkspace` / `changeWorkspaceSlug`). Smallest possible client
// boundary, matching F123's ProfileForm: the settings page above is a
// Server Component that loads the current values; this owns only the
// rename/slug-change interactions.
//
// F137: the slug field is a field-level error surface (AS-242) — a
// collision (live or historical) is shown right under the slug input,
// not as a generic toast alone, so the user knows exactly which field to
// fix.
//
// Logo: the clarified spec calls for "a logo placeholder/stub if F138
// hasn't landed" — F138 (workspace logo upload) has not landed in this
// tree (checked: no `logo_url` column on `workspaces`, no upload action),
// so this renders a static, disabled placeholder rather than inventing a
// second, half-built upload flow out of this feature's scope.
//
// Failure handling (clarified spec): the optimistic name change reverts
// to the last-saved value on a server rejection, and a sonner toast
// states what failed in plain language; the form returns to an
// actionable state.

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { renameWorkspace, changeWorkspaceSlug } from "@/lib/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WorkspaceGeneralForm({
  workspaceId,
  name: initialName,
  slug: initialSlug,
  canManage,
}: {
  workspaceId: string;
  name: string;
  slug: string;
  canManage: boolean;
}) {
  const [savedName, setSavedName] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, startSaveTransition] = useTransition();

  const [savedSlug, setSavedSlug] = useState(initialSlug);
  const [slug, setSlug] = useState(initialSlug);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [isSavingSlug, startSaveSlugTransition] = useTransition();

  const isDirty = name !== savedName;
  const isSlugDirty = slug !== savedSlug;

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setFormError(null);

    startSaveTransition(async () => {
      const result = await renameWorkspace(workspaceId, name);

      if (result.ok) {
        setSavedName(result.data.name);
        setName(result.data.name);
        toast.success("Workspace renamed.");
      } else {
        // The optimistic change reverts to the last-saved value rather
        // than leaving the rejected attempt on screen, and the form
        // returns to an actionable state (isSaving clears once this
        // transition finishes) — same convention as ProfileForm (F123).
        setName(savedName);
        setFormError(result.error);
        toast.error(result.error);
      }
    });
  }

  // F137 (AS-241, AS-242): saved separately from the name — the two
  // fields have different consequences (renaming is cosmetic; changing
  // the slug moves the workspace's URL and is what
  // workspace_slug_history/the layout redirect exist to make safe) and
  // different failure surfaces (a slug collision is field-level, shown
  // right under this input).
  function handleSlugSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setSlugError(null);

    startSaveSlugTransition(async () => {
      const result = await changeWorkspaceSlug(workspaceId, slug);

      if (result.ok) {
        setSavedSlug(result.data.slug);
        setSlug(result.data.slug);
        toast.success("Workspace URL updated.");
      } else {
        // Same revert-to-last-saved convention as the name form above.
        setSlug(savedSlug);
        setSlugError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        {/* F138 (logo upload) has not landed — static placeholder only,
            not a functioning control, per this feature's clarified
            scope. */}
        <Label>Logo</Label>
        <div
          aria-hidden="true"
          className="flex size-16 items-center justify-center rounded-lg border border-dashed bg-muted text-xs text-muted-foreground"
        >
          No logo
        </div>
        <p className="text-sm text-muted-foreground">
          Workspace logos aren&rsquo;t supported yet.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="workspace-name">Name</Label>
          <Input
            id="workspace-name"
            name="name"
            type="text"
            maxLength={80}
            disabled={!canManage || isSaving}
            value={name}
            onChange={(changeEvent) => setName(changeEvent.target.value)}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? "workspace-name-error" : undefined}
            className="max-w-sm"
          />
        </div>

        {formError && (
          <p
            id="workspace-name-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {formError}
          </p>
        )}

        {canManage && (
          <Button
            type="submit"
            disabled={isSaving || !isDirty}
            className="w-fit"
          >
            {isSaving ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Saving...
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        )}
      </form>

      {/* F137 (AS-241, AS-242): the slug is now editable, saved through
          its own action/transition (see handleSlugSubmit above) so a
          rename and a URL change never share one optimistic-revert
          state. */}
      <form onSubmit={handleSlugSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="workspace-slug">URL slug</Label>
          <Input
            id="workspace-slug"
            name="slug"
            type="text"
            maxLength={80}
            disabled={!canManage || isSavingSlug}
            value={slug}
            onChange={(changeEvent) =>
              setSlug(changeEvent.target.value.toLowerCase())
            }
            aria-invalid={slugError ? true : undefined}
            aria-describedby={slugError ? "workspace-slug-error" : undefined}
            className="max-w-sm"
          />
          <p className="text-sm text-muted-foreground">
            Changing this updates the workspace&rsquo;s URL. Links using the
            old URL will keep working — they redirect here automatically.
          </p>
        </div>

        {slugError && (
          <p
            id="workspace-slug-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {slugError}
          </p>
        )}

        {canManage && (
          <Button
            type="submit"
            disabled={isSavingSlug || !isSlugDirty}
            className="w-fit"
          >
            {isSavingSlug ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Saving...
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        )}
      </form>
    </div>
  );
}
