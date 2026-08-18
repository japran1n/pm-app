import { z } from "zod";

// Validates uploadAvatar input (F121: AS-203, AS-205, AS-206). Mirrors the
// file-layout convention established by lib/validation/attachments.ts:
// limits are declared once here and used by both the client input and the
// Server Action's server-side check (lib/actions/profile.ts). The same
// numeric values are also mirrored into the `avatars` Storage bucket's
// `file_size_limit`/`allowed_mime_types` config in
// supabase/migrations/20260818201642_create_avatars_bucket.sql as an
// additional enforcement layer — if these constants change, that migration
// (or a follow-up one) must be updated to match.

// AS-205: max avatar size. Smaller than attachments' 10MB — an avatar is
// a single small profile picture rendered at thumbnail size on every task
// card app-wide, not an arbitrary document. 2MB comfortably covers a
// full-resolution phone photo while keeping the public avatars bucket from
// growing unnecessarily large per user.
export const MAX_AVATAR_SIZE_BYTES = 2 * 1024 * 1024; // 2MB

// AS-206: allowed MIME types. A closed allowlist of the three common raster
// web-image formats — deliberately narrower than attachments' allowlist
// (no PDFs/office docs/SVG here; an avatar is always a photo/image, never
// a document). Excluding SVG specifically: it is a document format that
// can carry embedded scripts, and there is no legitimate "vector avatar
// upload" use case this feature needs to support.
export const ALLOWED_AVATAR_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const uploadAvatarSchema = z.object({
  fileSize: z
    .number()
    .int()
    .positive("File is empty.")
    .max(
      MAX_AVATAR_SIZE_BYTES,
      `Avatar must be ${MAX_AVATAR_SIZE_BYTES / (1024 * 1024)}MB or smaller.`,
    ),
  mimeType: z
    .string()
    .refine(
      (value) =>
        (ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(value),
      { message: "Avatar must be a JPEG, PNG, or WebP image." },
    ),
});

export type UploadAvatarInput = z.infer<typeof uploadAvatarSchema>;
