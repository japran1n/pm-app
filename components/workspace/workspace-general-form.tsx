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
// Logo (F138, AS-243): "an owner can upload a logo, shown in the
// workspace switcher." Uploads through `uploadWorkspaceLogo`
// (lib/actions/workspaces.ts), which reuses F121's/F274's avatar
// upload/validation helpers (size limit, magic-byte MIME sniffing)
// rather than a second upload path — see that action's own doc comment
// and this feature's handoff for the bucket/prefix choice. `canManage`
// (owner/admin) gates the control the same way it gates the name/slug
// forms below; the server-side `requireWorkspaceAdmin` check in the
// action is the actual enforcement boundary.
//
// Failure handling (clarified spec): the optimistic name change reverts
// to the last-saved value on a server rejection, and a sonner toast
// states what failed in plain language; the form returns to an
// actionable state. The logo upload follows the same convention: on
// failure the previously-saved logo is kept on screen (nothing is
// optimistically swapped in before the server confirms), a toast states
// what failed, and the file input is re-enabled.

import { useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  renameWorkspace,
  changeWorkspaceSlug,
  uploadWorkspaceLogo,
} from "@/lib/actions/workspaces";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { WorkspaceLogo } from "@/components/workspace/workspace-logo";

export function WorkspaceGeneralForm({
  workspaceId,
  name: initialName,
  slug: initialSlug,
  logoUrl: initialLogoUrl,
  canManage,
}: {
  workspaceId: string;
  name: string;
  slug: string;
  logoUrl?: string | null;
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

  const [logoUrl, setLogoUrl] = useState(initialLogoUrl ?? null);
  const [isUploadingLogo, startUploadLogoTransition] = useTransition();
  const logoInputRef = useRef<HTMLInputElement>(null);

  const isDirty = name !== savedName;
  const isSlugDirty = slug !== savedSlug;

  function handleLogoChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input value immediately so selecting the exact same file
    // again after a failed upload still fires this handler.
    event.target.value = "";
    if (!file) return;

    const formData = new FormData();
    formData.set("workspaceId", workspaceId);
    formData.set("file", file);

    startUploadLogoTransition(async () => {
      const result = await uploadWorkspaceLogo(formData);

      if (result.ok) {
        setLogoUrl(result.data.logoUrl);
        toast.success("Workspace logo updated.");
      } else {
        // The previously-saved logo was never replaced on screen (no
        // optimistic swap before the server confirms), so there is
        // nothing to revert — just surface the failure and return the
        // control to an actionable state (isUploadingLogo clears once
        // this transition finishes).
        toast.error(result.error);
      }
    });
  }

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
        <Label htmlFor="workspace-logo-input">Logo</Label>
        <div className="flex items-center gap-3">
          <WorkspaceLogo
            workspaceId={workspaceId}
            name={savedName}
            logoUrl={logoUrl}
            size="lg"
          />
          {canManage && (
            <>
              <input
                ref={logoInputRef}
                id="workspace-logo-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                disabled={isUploadingLogo}
                onChange={handleLogoChange}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isUploadingLogo}
                onClick={() => logoInputRef.current?.click()}
              >
                {isUploadingLogo ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Uploading...
                  </>
                ) : logoUrl ? (
                  "Change logo"
                ) : (
                  "Upload logo"
                )}
              </Button>
            </>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          JPEG, PNG, or WebP, up to 2MB. Shown in the workspace switcher.
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
          <p className="text-xs text-muted-foreground text-right max-w-sm">{name.length}/80</p>
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
          <p className="text-xs text-muted-foreground text-right max-w-sm">{slug.length}/80</p>
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
