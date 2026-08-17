# Handoff: F017 — members list page

## Status
COMPLETE

## Assertions covered
AS-023: PASS — `tests/integration/workspace-members-list.test.ts` ("AS-023: separates active members from pending invites" and the cross-workspace isolation case), plus manually verified via `npm run build` (route compiles, `/w/[workspaceSlug]/settings/members` registered as a dynamic route).

## Files changed
app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx
app/(workspace)/w/[workspaceSlug]/settings/members/loading.tsx
components/invite-member-form.tsx
lib/queries/members.ts
tests/integration/workspace-members-list.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0)
`npm test` (0) — 51/51 passing, including the 2 new AS-023 tests
`npm run build` (0)

## Decisions made
- No `public.profiles`/users table or view exists in this schema (checked `supabase/migrations/` — F011's migration only creates `workspaces` and `workspace_members`; `auth.users` is not exposed through PostgREST). To resolve active members' emails I used the Auth Admin API (`admin.auth.admin.getUserById`) via the secret-key admin client, the same approach `inviteMember` already takes for its by-email duplicate check. This is read-only, server-only, and only resolves a display value for rows already permitted by RLS — it does not widen which rows are visible. Documented as a known limitation in `lib/queries/members.ts`: this is one Auth Admin API call per active member, acceptable at this milestone's scale but worth revisiting (a `profiles` table populated by an `auth.users` trigger) if member lists grow large.
- Added a simple invite form (`components/invite-member-form.tsx`) pairing with F015's already-implemented `inviteMember` Server Action, per the spec's explicit option to do so. It's the page's only Client Component (smallest boundary), shown only when the caller's own role is owner/admin — a UI convenience gate only; `inviteMember` re-verifies permission server-side regardless (AS-143 convention), so hiding the form here isn't a security boundary.
- `inviteMember(workspaceId, email)` takes plain args, not the `(prevState, formData)` shape `useActionState` expects, so the form wraps it with `useState` + `useTransition` instead of reusing the sign-in form's `useActionState` pattern.
- Data-fetching lives in `lib/queries/members.ts` (`getWorkspaceMembers`) rather than inline in the page, so it's independently testable with an integration test that exercises real RLS (mirrors `tests/integration/rls-workspaces.test.ts`'s pattern of signing in a real throwaway user via `signInWithPassword` rather than faking `auth.getUser()` on top of an admin client — the latter would bypass RLS entirely and the isolation test would pass for the wrong reason).
- Error state: this repo has no Sentry (or any error-tracking SDK) installed yet (checked `package.json` and the repo tree) despite the clarified spec mentioning "real error logged to Sentry." Followed the existing repo-wide convention instead (every action/page here uses `console.error`) rather than introducing a new dependency out of scope for this feature. Flagging this as a gap for the orchestrator/tech-decisions.md rather than silently deviating further.
- Four states are handled explicitly: loading (`loading.tsx` using shadcn `Skeleton`, Next.js's file-convention Suspense boundary for this Server Component page), populated (Table sections), empty (explicit "No active members yet." / "No pending invites." messages per section), error (inline alert + retry link that reloads the same URL, wrapping `getWorkspaceMembers` in try/catch so a fetch failure doesn't crash the whole page).
- Used shadcn `Table` + `Badge` (both already in `components/ui/`) rather than a plain list, per the spec's explicit option.

## Out-of-scope work needed
- Role-change (F019), remove member (F020), revoke invite (F018) actions are not implemented here — left as separate features per the spec. The pending-invites table has no actions column yet; F018 will likely add a revoke button there.
- If member lists grow large, introduce a `public.profiles` table (trigger-populated from `auth.users`) so member email/name resolution doesn't require N Auth Admin API calls per page render.
- Sentry (or equivalent) isn't wired into this repo at all yet; the clarified spec's "error state" answer assumes it is. Worth a decision in `tech-decisions.md` for a future milestone if real error tracking is wanted.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Included the invite form on this page (spec offered both options and judged pairing it here as the more natural UI, since F015's action already exists and there's no other page to host it on yet).
AUTONOMOUS_DECISION: Used `console.error` instead of Sentry for the error state's "real error logged" requirement, since no error-tracking SDK exists in the repo.
AUTONOMOUS_DECISION: Resolved active-member emails via `admin.auth.admin.getUserById` per row (documented limitation) since no profiles table/view exists.

## Notes for the next worker
- `getWorkspaceMembers` in `lib/queries/members.ts` is the reusable data-fetch — F018/F019/F020 will likely want to revalidate this same path (`/w/[slug]/settings/members`) after their mutations, matching `inviteMember`'s existing `revalidatePath` call.
- The invite form only renders for owner/admin viewers; F018's revoke button (if added to the pending-invites table) should probably follow the same `canInvite`-style gate for consistency.
- Test pattern for anything reading `workspace_members` under RLS: sign a real throwaway user in with `signInWithPassword` via the publishable-key client and mock `lib/supabase/server`'s `createClient` to return that signed-in client — do NOT fake `auth.getUser()` on top of an admin client, since that bypasses RLS entirely and isolation tests will pass for the wrong reason (caught this exact mistake while writing `tests/integration/workspace-members-list.test.ts`).
