"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadAvatarSchema } from "@/lib/validation/profile";

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

export type UploadAvatarResult =
  | {
      ok: true;
      data: {
        avatarUrl: string;
      };
    }
  | { ok: false; error: string };

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

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to upload an avatar." };
  }

  const admin = createAdminClient();

  // Fixed path per user (no extension) — see the module-level comment.
  // upsert: true so a replacement overwrites the previous object instead
  // of creating a second one (AS-203's "no orphans on replace").
  const objectPath = `${user.id}/avatar`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await admin.storage
    .from(AVATARS_BUCKET)
    .upload(objectPath, arrayBuffer, {
      contentType: parsed.data.mimeType,
      upsert: true,
    });

  if (uploadError) {
    console.error("uploadAvatar: storage upload failed:", uploadError);
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
    console.error("uploadAvatar: profiles update failed:", updateError);
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
    console.error(
      "uploadAvatar: revalidatePath failed (non-fatal):",
      revalidateError,
    );
  }

  return { ok: true, data: { avatarUrl } };
}
