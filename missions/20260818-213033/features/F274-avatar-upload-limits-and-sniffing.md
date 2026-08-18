# F274: make the avatar limit reachable and the type check content-based

**Milestone:** M10 (follow-up from M10 scrutiny)
**Estimated worker time:** 45 minutes
**Depends on:** F121, F123
**Parent feature:** F121 (inherits its clarification)

## Assertion IDs covered
- AS-203: an uploaded avatar replaces the initials avatar app-wide
- AS-205: an oversized upload is rejected with a message naming the limit
- AS-206: a non-image upload is rejected

## Why this exists
M10 scrutiny FAIL, with an independently reproduced mechanism: Next's default Server Action body limit is 1MB while the app's avatar limit is 2MB, so every avatar between 1MB and 2MB is rejected with a 413 before the action runs — and the form has no catch, so the user sees nothing at all. The >2MB case never reaches the validator that names the limit. Separately, type checking trusts the client-declared `File.type`: renaming `evil.exe` to `evil.png` is accepted and stored. See `missions/20260818-213033/milestones/M10-scrutiny.md` §§ AS-203/AS-205, AS-206.

## Draft scope
- Set `experimental.serverActions.bodySizeLimit` in `next.config.ts` above `MAX_AVATAR_SIZE_BYTES` (multipart overhead means a 2MB file exceeds a 2MB body — use '3mb').
- Client-side pre-flight size check using the same constant so a 413 is avoided entirely; wrap the `uploadAvatar` call in try/catch with object-URL revoke and preview revert in `finally`.
- Server-side magic-byte sniff of the leading bytes against the JPEG/PNG/WebP signatures, rejecting on mismatch with the declared type, before the Storage call.
- On profile-update failure after a successful upload, `remove([objectPath])` to match `uploadAttachment`'s existing cleanup.

## Files (approximate)
next.config.ts, lib/actions/profile.ts, lib/validation/profile.ts, components/profile/profile-form.tsx

## Clarified implementation
- Inherits F121's clarification (archetype: db/action). Limits stay declared once and mirrored into the bucket config.
- The sniff is a small local byte-signature check; do not add a file-type dependency.

## Definition of done
- A spoofed-MIME upload (non-image bytes declared image/png) is rejected server-side, with a test.
- An oversize upload crosses the real action pipeline and produces the limit-naming message, with a test.
- A test asserts the bucket config values equal the TypeScript constants.
- `npm run test`, `npx tsc --noEmit`, `npx eslint .` clean.
