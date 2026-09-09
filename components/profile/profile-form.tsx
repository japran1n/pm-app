"use client";

// F123 (AS-202): the profile settings page's interactive form — display
// name, avatar upload with live preview, and timezone. Smallest possible
// client boundary (clarified spec): the page above is a Server Component
// that loads the current values; this owns only the interaction.
//
// Reuses existing primitives rather than building new ones (clarified
// spec's Q10 default): `uploadAvatar` (lib/actions/profile.ts, F121) for
// the avatar field — this component does not write to Storage or
// `profiles.avatar_url` itself — and `<UserAvatar>` (F122) for the
// preview, so the preview renders through the exact same
// image-or-initials-on-a-deterministic-colour logic as every other avatar
// in the app.
//
// Failure handling (clarified spec, Q5): each field's optimistic change
// (the typed display name/timezone selection, or the locally-previewed
// avatar image) reverts to the last-saved value on a server rejection,
// and a sonner toast states what failed; the control is never left
// disabled or stuck after a failure.

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { updateProfile, uploadAvatar } from "@/lib/actions/profile";
import { MAX_AVATAR_SIZE_BYTES } from "@/lib/validation/profile";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function ProfileForm({
  userId,
  email,
  displayName: initialDisplayName,
  avatarUrl: initialAvatarUrl,
  timezone: initialTimezone,
  timezones,
}: {
  userId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  timezone: string;
  timezones: string[];
}) {
  // "Last saved" values — what a failed save reverts back to, and what
  // <UserAvatar>'s preview is built from before any local edit.
  const [savedDisplayName, setSavedDisplayName] = useState(
    initialDisplayName ?? "",
  );
  const [savedTimezone, setSavedTimezone] = useState(initialTimezone);

  const [displayName, setDisplayName] = useState(initialDisplayName ?? "");
  const [timezone, setTimezone] = useState(initialTimezone);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl);
  const [formError, setFormError] = useState<string | null>(null);

  const [isSaving, startSaveTransition] = useTransition();
  const [isUploadingAvatar, startAvatarTransition] = useTransition();

  const isDirty =
    displayName !== savedDisplayName || timezone !== savedTimezone;

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setFormError(null);

    const attemptedDisplayName = displayName;
    const attemptedTimezone = timezone;

    startSaveTransition(async () => {
      const result = await updateProfile(
        attemptedDisplayName,
        attemptedTimezone,
      );

      if (result.ok) {
        setSavedDisplayName(result.data.displayName);
        setSavedTimezone(result.data.timezone);
        setDisplayName(result.data.displayName);
        setTimezone(result.data.timezone);
        toast.success("Profile updated.");
      } else {
        // The optimistic change reverts to the last-saved values rather
        // than leaving the rejected attempt on screen, and the form
        // returns to an actionable state (isSaving clears once this
        // transition finishes).
        setDisplayName(savedDisplayName);
        setTimezone(savedTimezone);
        setFormError(result.error);
        toast.error(result.error);
      }
    });
  }

  function handleAvatarChange(
    changeEvent: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = changeEvent.target.files?.[0];
    // Reset the input so selecting the exact same file again still fires
    // a change event.
    changeEvent.target.value = "";
    if (!file) return;

    // F274 (AS-205): client-side pre-flight size check using the SAME
    // constant the server enforces, so an oversized file never reaches
    // the network at all — this is what avoids the 413 case entirely for
    // the common "picked an obviously too-big file" path, rather than
    // relying on next.config.ts's body-size headroom to let it through
    // just so the server can reject it.
    if (file.size > MAX_AVATAR_SIZE_BYTES) {
      toast.error(
        `Avatar must be ${MAX_AVATAR_SIZE_BYTES / (1024 * 1024)}MB or smaller.`,
      );
      return;
    }

    const previousAvatarUrl = avatarUrl;
    const previewUrl = URL.createObjectURL(file);
    setAvatarUrl(previewUrl);

    startAvatarTransition(async () => {
      // F274: wrapped in try/catch/finally — a request that still fails
      // at the HTTP layer (e.g. an unexpected 413, a network error)
      // previously rejected the promise with no `catch`, so
      // URL.revokeObjectURL never ran (leaking the local object URL) and
      // the optimistic preview was left stuck on screen with no toast.
      try {
        const formData = new FormData();
        formData.set("file", file);
        const result = await uploadAvatar(formData);

        if (result.ok) {
          setAvatarUrl(result.data.avatarUrl);
          toast.success("Avatar updated.");
        } else {
          // Revert the live preview back to whatever was showing before
          // this upload attempt.
          setAvatarUrl(previousAvatarUrl);
          toast.error(result.error);
        }
      } catch {
        setAvatarUrl(previousAvatarUrl);
        toast.error("Something went wrong. Please try again in a moment.");
      } finally {
        URL.revokeObjectURL(previewUrl);
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex items-center gap-4">
        <UserAvatar
          person={{ id: userId, name: displayName || null, email, avatarUrl }}
          size="lg"
        />
        <div className="flex flex-col gap-2">
          <Label htmlFor="avatar-upload">Avatar</Label>
          <Input
            id="avatar-upload"
            name="avatar"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={isUploadingAvatar}
            onChange={handleAvatarChange}
            className="max-w-xs"
          />
          {isUploadingAvatar && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              Uploading...
            </p>
          )}
        </div>
      </section>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="display-name">Display name</Label>
          <Input
            id="display-name"
            name="displayName"
            type="text"
            autoComplete="name"
            placeholder={email ?? "Your name"}
            maxLength={80}
            disabled={isSaving}
            value={displayName}
            onChange={(changeEvent) => setDisplayName(changeEvent.target.value)}
            aria-invalid={formError ? true : undefined}
            aria-describedby={formError ? "profile-form-error" : undefined}
            className="max-w-sm"
          />
          <p className="text-sm text-muted-foreground">
            Shown instead of your email everywhere you appear across the
            app.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="timezone">Timezone</Label>
          <Select
            value={timezone}
            onValueChange={(value) => {
              if (value) setTimezone(value);
            }}
            disabled={isSaving}
          >
            <SelectTrigger id="timezone" className="w-full max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {timezones.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            Used for due dates and overdue calculations across the app.
          </p>
        </div>

        {formError && (
          <p
            id="profile-form-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {formError}
          </p>
        )}

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
      </form>
    </div>
  );
}
