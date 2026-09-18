"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  uploadAvatarSchema,
  updateProfileSchema,
  matchesDeclaredAvatarMimeType,
} from "@/lib/validation/profile";
import { logger } from "@/lib/observability/logger";
import type { ActionResult } from "@/lib/actions/authz";

// Storage bucket + path convention fixed by F121
// (supabase/migrations/20260818201642_create_avatars_bucket.sql): bucket
// `avatars`, PUBLIC (unlike the private `task-attachments` bucket), object
// path `{user_id}/avatar` with NO extension in the name. Every upload uses
// upsert=true against this exact path, so a new avatar always overwrites
// the previous Storage object in place — there is at most one object per
// user, which is what makes "replacing an avatar never accumulates
// orphaned objects" true by construction. Do not change this path shape
// without also updating the bucket's RLS policies, which parse the first
// path segment as the owning user's id.
const AVATARS_BUCKET = "avatars";

export type UploadAvatarResult = ActionResult<{
        avatarUrl: string;
      }>;

// Uploads/replaces the signed-in user's avatar (F121: AS-203, AS-205,
// AS-206). Pattern mirrors lib/actions/attachments.ts's uploadAttachment:
// Zod-validated input checked *before* any Storage call, admin client for
// the actual Storage write + profiles update, discriminated-union return,
// generic user-facing errors with details only logged server-side.
//
// Takes a FormData for the same reason uploadAttachment does — Server
// Actions receive `File` objects through FormData, not as plain function
// arguments. The caller is expected to build `new FormData()` with a
// `file` field.
//
// AS-205/AS-206 (size + MIME) are validated *before* any Storage call is
// made — the file never leaves this function's early-return path if it
// fails either check.
export async function uploadAvatar(
  formData: FormData,
): Promise<UploadAvatarResult> {
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return { ok: false, error: "Invalid upload request." };
  }

  const parsed = uploadAvatarSchema.safeParse({
    fileSize: file.size,
    mimeType: file.type,
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid file.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to upload an avatar." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  // Fixed path per user (no extension) — see the module-level comment.
  // upsert: true so a replacement overwrites the previous object instead
  // of creating a second one (AS-203's "no orphans on replace").
  const objectPath = `${user.id}/avatar`;
  const arrayBuffer = await file.arrayBuffer();

  // AS-206 (F274 hardening): the declared MIME type checked above is
  // entirely client-controlled (a renamed `evil.exe` reports
  // `image/png`), so before anything is written to Storage the actual
  // leading bytes are sniffed against real JPEG/PNG/WebP signatures and
  // compared to what was declared. A mismatch is rejected here, never
  // silently "corrected" to the sniffed type — the file simply isn't what
  // it claimed to be.
  if (
    !matchesDeclaredAvatarMimeType(
      new Uint8Array(arrayBuffer),
      parsed.data.mimeType,
    )
  ) {
    return {
      ok: false,
      error: "Avatar must be a JPEG, PNG, or WebP image.",
    };
  }

  const { error: uploadError } = await admin.storage
    .from(AVATARS_BUCKET)
    .upload(objectPath, arrayBuffer, {
      contentType: parsed.data.mimeType,
      upsert: true,
    });

  if (uploadError) {
    logger.error("uploadAvatar: storage upload failed", { error: uploadError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // The bucket is public, so a plain public URL (not a signed URL) is
  // correct here — see the migration's Decisions comment for why avatars
  // deliberately diverge from attachments' private+signed-URL pattern.
  //
  // A cache-busting query param is appended and stored as part of
  // avatar_url itself: because the object path is fixed and reused on
  // every replacement, Supabase's CDN (and any browser cache) would
  // otherwise keep serving the previous image at the exact same URL after
  // a successful replace. Storing the busted URL means every reader that
  // just re-fetches `profiles.avatar_url` (no extra Storage call) always
  // gets the current image, which is required for AS-203 ("replaces the
  // initials avatar app-wide") to actually be visible immediately.
  const { data: publicUrlData } = admin.storage
    .from(AVATARS_BUCKET)
    .getPublicUrl(objectPath);

  const avatarUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;

  const { error: updateError } = await admin
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id);

  if (updateError) {
    logger.error("uploadAvatar: profiles update failed", { error: updateError });
    // Best-effort cleanup so a failed profiles update doesn't leave the
    // just-uploaded Storage object orphaned — mirrors
    // uploadAttachment's post-Storage-success cleanup pattern in
    // lib/actions/attachments.ts. Unlike attachments' fresh per-upload
    // path, this deletes the object this call itself just wrote (the
    // fixed per-user path), not a previous avatar.
    await admin.storage.from(AVATARS_BUCKET).remove([objectPath]);
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // Avatars render app-wide (task cards, headers, member lists across
  // every workspace the user belongs to), not on a single
  // workspace-scoped path like an attachment's task — so the whole app
  // layout is revalidated rather than one workspace slug.
  try {
    revalidatePath("/", "layout");
  } catch (revalidateError) {
    // Non-fatal cache-freshness rationale, same as uploadAttachment.
    logger.error("uploadAvatar: revalidatePath failed (non-fatal)", { error: revalidateError });
  }

  return { ok: true, data: { avatarUrl } };
}

export type UpdateProfileResult = ActionResult<{
        displayName: string;
        timezone: string;
      }>;

// Sets the signed-in user's display name and timezone (F123: AS-202 —
// "a user can set their display name, and that name is shown instead of
// their email everywhere a person is rendered"). The timezone field rides
// along in the same action because it's the other field this feature's
// settings page owns; F124 is the feature that actually *consumes*
// `profiles.timezone` for due-date/overdue math — this action's job is
// only to validate and persist a real IANA identifier so that later
// feature has something correct to read.
//
// Takes plain arguments (not FormData) — same convention as
// `inviteMember`/`changeMemberRole` in lib/actions/workspaces.ts, since
// neither field here is a file upload.
//
// AS-208's "a user cannot edit another user's profile, including via a
// direct API call" is enforced two ways at once, deliberately redundant:
// (1) this action never accepts a target user id as input at all — the
// row updated is always `.eq("id", user.id)` from the caller's own
// server-verified session, so there is no argument a caller could pass to
// make it touch anyone else's row; (2) even if that guarantee were ever
// broken by a future edit, `profiles_update_self`'s RLS policy (F120,
// supabase/migrations/20260818200946_create_profiles.sql) still rejects
// it at the database layer. AS-208 itself is F120's assertion and already
// has its own RLS-level test (tests/integration/rls-profiles.test.ts);
// this feature's own test instead proves guarantee (1) — that calling
// this action while signed in as one user never changes a different
// user's row, full stop.
export async function updateProfile(
  displayName: string,
  timezone: string,
): Promise<UpdateProfileResult> {
  const parsed = updateProfileSchema.safeParse({ displayName, timezone });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid profile input.",
    };
  }

  const { user } = await getCurrentUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to update your profile." };
  }

  // eslint-disable-next-line no-restricted-syntax -- ARCH-003: workspace-scoped lookup bypasses RLS to resolve authorization/scoping data; caller identity already verified via getCurrentUser()/!user check immediately above
  const admin = createAdminClient();

  const { error: updateError } = await admin
    .from("profiles")
    .update({
      display_name: parsed.data.displayName,
      timezone: parsed.data.timezone,
    })
    .eq("id", user.id);

  if (updateError) {
    logger.error("updateProfile: profiles update failed", { error: updateError });
    return {
      ok: false,
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // AS-202: the display name replaces the email everywhere a person is
  // rendered app-wide (task cards, comments, members list, pickers — see
  // lib/queries/people.ts's resolvePeople, the single resolver every one
  // of those surfaces reads through), not just on a single
  // workspace-scoped path — so, like uploadAvatar, the whole app layout is
  // revalidated rather than one workspace slug.
  try {
    revalidatePath("/", "layout");
  } catch (revalidateError) {
    // Non-fatal cache-freshness rationale, same as uploadAvatar.
    logger.error("updateProfile: revalidatePath failed (non-fatal)", { error: revalidateError });
  }

  return {
    ok: true,
    data: { displayName: parsed.data.displayName, timezone: parsed.data.timezone },
  };
}
