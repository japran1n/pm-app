# Handoff: F018 — revoke invite action

## Status
COMPLETE

## Assertions covered
AS-024: PASS — owner/admin can revoke a pending invite (row deleted); plain member is rejected server-side; unauthenticated caller is rejected; attempting to revoke an already-active (non-invited) row is rejected and the row is left untouched; cross-workspace id mismatch is rejected without touching the other workspace's row. 6/6 tests passing in `tests/integration/revoke-invite.test.ts` against the real linked Supabase project.

## Files changed
lib/actions/workspaces.ts
lib/validation/workspaces.ts
components/revoke-invite-button.tsx
app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx
tests/integration/revoke-invite.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npx vitest run tests/integration/revoke-invite.test.ts` (0, 6/6 passed)
`npm run test` (0, 57/57 passed across all test files)
`npm run build` (0)

## Decisions made
- Put `revokeInvite` in `lib/actions/workspaces.ts` (not a new `lib/actions/invites.ts`) because `inviteMember` — the closely related action — already lives there and F016's `lib/actions/invites.ts` holds a different concern (sign-in-time invite activation, not a Server Action). Consistency with the existing file wins over splitting.
- Reused `requireWorkspaceAdmin` from `lib/auth/require-membership.ts` (F015's established pattern) for the server-side owner/admin re-check rather than writing a new helper.
- Target row is looked up by `id` + `workspace_id` first, then the DELETE itself is additionally scoped to `.eq("status", "invited")` as a second guard — belt-and-suspenders so this action can never delete an active member row even under a race, per the spec's explicit "not accidentally deleting an active member" instruction (F020 is a separate feature).
- Used a plain `window.confirm` in `RevokeInviteButton` instead of shadcn's AlertDialog: `components/ui/` has no alert-dialog component installed in this repo yet, and pulling one in for a single destructive click was judged out of scope. The spec left this choice to the worker.
- Icon-only ghost `Button` (`variant="ghost" size="icon"`, lucide `X` icon) added only to the pending-invites table, shown only when `canInvite` is true (same UI-only convenience gate `InviteMemberForm` already uses — the real permission boundary is server-side in `revokeInvite`).
- Cache invalidation follows `inviteMember`'s existing pattern exactly: `revalidatePath` wrapped in try/catch since it throws outside a request/render context (e.g. in tests), treated as non-fatal since the mutation itself already succeeded.

## Out-of-scope work needed
- F020 ("remove active member") is explicitly not implemented here — `revokeInvite` refuses to touch any row whose status isn't `invited`.
- No shadcn AlertDialog component exists in this repo; if a future feature wants a richer confirm UX, that component needs to be added via `npx shadcn add alert-dialog` first.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: chose `window.confirm` over shadcn AlertDialog for the revoke confirmation, since the spec explicitly left the confirm mechanism to the worker's choice and AlertDialog isn't installed in this repo.

## Notes for the next worker
- The members page (`app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx`) now has a 4th column in the pending-invites table ("Actions", visually a `sr-only` header) rendered only for owners/admins — keep that pattern if adding more row actions later.
- `tests/integration/revoke-invite.test.ts` follows the exact loadDotEnv/skipIf/vi.mock scaffold used by `tests/integration/invite-member.test.ts` — copy that file's structure for any future Server Action integration test rather than reinventing it.
