# Handoff: F064 — db schema attachments

## Status
COMPLETE

## Assertions covered
AS-106: PASS — `task-attachments` Storage bucket created with `public = false`; verified in test via `adminClient.storage.getBucket` (`bucket.public === false`) and via anon-key list/read denial.
AS-107: PASS — non-member cannot SELECT the `attachments` row, cannot `createSignedUrl` for the object (even knowing the exact path), and cannot upload into the task's path prefix; all enforced by `storage.objects` RLS policies joined through `is_task_workspace_member`.

## Files changed
supabase/migrations/20260818050100_create_attachments.sql
lib/supabase/database.types.ts
tests/integration/rls-attachments.test.ts

## Commands run
`supabase migration new create_attachments` (0)
`supabase db push --linked` (0)
`supabase gen types typescript --linked > lib/supabase/database.types.ts` (0)
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run tests/integration/rls-attachments.test.ts` (0 — 9/9 passed)
`npm test` (0 — 352/352 passed, full suite)
`npm run build` (0)

## Decisions made
- Reused `public.is_task_workspace_member(task_id)` from F058's comments migration instead of duplicating a helper — same join depth (attachments -> tasks -> projects -> workspace_members).
- No soft-delete column on `attachments`, per this feature's spec (F067 will hard-delete row + Storage object together). Diverges intentionally from the `comments` convention (which uses `deleted_at`), so I did not add `deleted_at` filtering to the SELECT policy.
- Storage path convention: `{task_id}/{filename-or-uuid}` as the first path segment inside the `task-attachments` bucket. `attachments.file_url` stores this same object path (not a public URL).
- Two different authorization strategies for `storage.objects`, deliberately:
  - **SELECT** policy joins `storage.objects.name` back to `attachments.file_url` and checks `is_task_workspace_member(attachments.task_id)`. This is the "maintain authorization via the attachments table" option from the spec — single source of truth, no path-parsing for reads.
  - **INSERT** policy instead parses `task_id` out of the object path's first segment (`split_part(name, '/', 1)::uuid`) and checks membership on that task directly. This is necessary because at upload time the `attachments` row does not exist yet (F065's upload flow will write the Storage object and the `attachments` row in the same request) — there is nothing for a SELECT-style join to match against. Documented in the migration's comments so F065/F067 don't accidentally break the convention (F065 MUST put the task id as the object path's first segment, or uploads will be rejected).
- Bucket created declaratively via `insert into storage.buckets (...) on conflict (id) do nothing` in the same migration as the table/RLS, rather than a separate CLI/dashboard step, so the whole feature is reproducible from one migration file.
- No UPDATE/DELETE policies on `attachments` or `storage.objects` in this migration — AS-110/AS-111 (uploader-or-admin delete) are explicitly out of scope for F064 and are F067's job, mirroring the F058 -> F061 split precedent for comments. Absence of a policy denies those ops by default under RLS.
- Migration timestamp: `supabase migration new` initially generated `20260818043944`, which sorted *before* the already-applied `20260818050000_realtime_comments_publication.sql` on the remote (host clock vs. remote-applied migration ordering mismatch). Renamed to `20260818050100` before pushing so it applies strictly after the latest applied remote migration; `supabase db push --linked` then succeeded cleanly with no manual SQL intervention.

## Out-of-scope work needed
- F065 (upload feature) must upload objects to `{task_id}/{name}` and insert the corresponding `attachments` row in the same request/transaction, per the path convention and INSERT-policy design above.
- F067 (delete feature) must delete both the `attachments` row and the Storage object together (no soft-delete exists to fall back on), and needs UPDATE/DELETE policies added to both `attachments` and `storage.objects`, scoped to uploader-or-workspace-admin/owner (AS-110/AS-111).
- AS-112 (file size limit rejection) is not addressed here — it's an upload-time (F065) concern, likely enforced both client-side and via a Storage bucket file-size-limit setting; not created in this migration since it wasn't in F064's assigned assertions.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the "attachments-table-backed" authorization approach for storage.objects SELECT (per the spec's suggested alternative) rather than pure path-parsing for all operations, because it avoids a second implementation of "who can see this task's data" — but had to fall back to path-parsing specifically for INSERT since the attachments row doesn't exist yet at upload time. This hybrid is documented in the migration file itself as the binding convention for F065/F067.

## Notes for the next worker
- Bucket name: `task-attachments`.
- Path convention: `{task_id}/{filename}` — the *first* path segment must be the task's UUID for both the SELECT (via attachments join) and INSERT (via path parsing) policies to authorize correctly.
- `is_task_workspace_member(uuid)` (defined in F058's migration, `supabase/migrations/20260818040214_create_comments.sql`) is reused as-is; no new SECURITY DEFINER helper was added.
- Verification test: `tests/integration/rls-attachments.test.ts` — creates two workspaces/users via the secret-key admin client, uploads a real object with the admin client (bypasses RLS, simulating F065's server-side flow), then asserts member-A can read/insert/get-a-working-signed-URL while a workspace-B user gets zero rows, an insert rejection, a signed-URL error, and an upload rejection. Run with `npx vitest run tests/integration/rls-attachments.test.ts` (needs `.env` with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` — already present in this repo's `.env`).
- No Supabase MCP tools were available/used in this session; verification was done via the `supabase` CLI (`db push`, `gen types`, `migration list`) and the vitest integration test against the real linked project (`qcipqonnqajmazdbysow`).
