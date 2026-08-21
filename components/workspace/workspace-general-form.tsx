"use client";

// F136 (AS-239, AS-240): the settings page's interactive "General" section
// — workspace name (editable) and slug (read-only, see `renameWorkspace`'s
// own comment for why slug is out of scope here). Smallest possible client
// boundary, matching F123's ProfileForm: the settings page above is a
// Server Component that loads the current values; this owns only the
// rename interaction.
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

import { renameWorkspace } from "@/lib/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function WorkspaceGeneralForm({
  workspaceId,
  name: initialName,
  slug,
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

  const isDirty = name !== savedName;

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

        <div className="flex flex-col gap-2">
          <Label htmlFor="workspace-slug">Slug</Label>
          <Input
            id="workspace-slug"
            type="text"
            value={slug}
            readOnly
            disabled
            className="max-w-sm"
          />
          <p className="text-sm text-muted-foreground">
            The URL slug can&rsquo;t be changed once a workspace is
            created.
          </p>
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
    </div>
  );
}
