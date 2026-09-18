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

// AS-205: max avatar size. Smaller than attachments' 4MB — an avatar is
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

// F274 (AS-206): the declared `File.type`/`mimeType` sniffed above is
// client-controlled — renaming `evil.exe` to `evil.png` gets `image/png`
// from the browser and previously sailed through every enforcement layer
// unchecked. This checks the ACTUAL bytes against each allowed format's
// real magic-byte signature and rejects on mismatch with what was
// declared, before the Storage call ever happens. Deliberately a small
// local byte-signature check (per this feature's clarified spec) rather
// than adding a `file-type` npm dependency — three fixed-offset signature
// comparisons don't need a library.
//
// Signatures:
//  - JPEG: FF D8 FF (all JPEG variants start with this 3-byte SOI marker)
//  - PNG:  89 50 4E 47 0D 0A 1A 0A (the 8-byte PNG signature)
//  - WebP: "RIFF" (bytes 0-3) + "WEBP" (bytes 8-11) — the RIFF container
//    tag followed by the WEBP form type at a fixed offset (bytes 4-7 are a
//    file-size field that varies per file and are intentionally skipped)
export function sniffAvatarMimeType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.length >= pngSignature.length &&
    pngSignature.every((byte, index) => bytes[index] === byte)
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }

  return null;
}

// Returns true when the declared MIME type matches the file's actual
// sniffed content — the check `uploadAvatar` (lib/actions/profile.ts)
// enforces before ever calling Storage.
export function matchesDeclaredAvatarMimeType(
  bytes: Uint8Array,
  declaredMimeType: string,
): boolean {
  return sniffAvatarMimeType(bytes) === declaredMimeType;
}

// Validates updateProfile input (F123: AS-202 — set a display name; the
// timezone field rides along in the same action/form since F124's
// due-date/overdue math needs a valid IANA identifier stored, and the
// clarified spec's Draft scope groups both fields into one settings page).
//
// Timezone validity is checked by attempting to *construct*
// `Intl.DateTimeFormat` with the candidate value as `timeZone`, catching
// the `RangeError` it throws for anything the runtime doesn't recognise —
// deliberately NOT `Intl.supportedValuesOf("timeZone").includes(value)`.
// That list (used to populate the select's options — see
// app/(workspace)/w/[workspaceSlug]/settings/profile/page.tsx) is CLDR's
// list of canonical IANA zone *names* and does not include the bare
// string "UTC" (only "Etc/UTC"), even though "UTC" is a value
// `Intl.DateTimeFormat`/every date library accepts and is F120's own
// `profiles.timezone` column default
// (supabase/migrations/20260818200946_create_profiles.sql). A Set-based
// membership check against `supportedValuesOf` would reject every user's
// own unchanged default the first time they saved this form with the
// select's initial value untouched — verified by hand: `node -e
// "console.log(Intl.supportedValuesOf('timeZone').includes('UTC'))"`
// prints `false`. The construction-based check accepts "UTC" (and any
// other alias the runtime legitimately resolves) while still rejecting
// garbage input, without hand-maintaining a second exceptions list next
// to the auto-generated one.
function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const updateProfileSchema = z.object({
  // AS-202: "a user can set their display name". Trimmed and required —
  // an all-whitespace/empty name would either render as blank or fall
  // through to the initials/email fallback silently, which is worse UX
  // than a clear validation error explaining why the save didn't take.
  displayName: z
    .string()
    .trim()
    .min(1, "Display name is required.")
    .max(80, "Display name must be 80 characters or fewer."),
  timezone: z.string().refine(isValidTimeZone, {
    message: "Select a valid timezone.",
  }),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
