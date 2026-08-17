# F019: change member role action

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 25 minutes
**Depends on:** F017

## Assertion IDs covered
- AS-014
- AS-015
- AS-019

## Draft scope
- Server Action: owner changes a member's role between member/admin
- Rejects the change server-side if caller is not owner, even if UI is bypassed

## Files (approximate)
lib/actions/workspaces.ts

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none


## Clarified implementation

_Appended by /mission-tasks — accept-and-continue mode, ★ defaults._

- **Pattern:** single exported async function in `lib/actions/<entity>.ts`.
- **Return contract:** discriminated union `{ ok: true, data } | { ok: false, error }` — never throws across the Server Action boundary.
- **Validation:** Zod schema in `lib/validation/<entity>.ts`, matching the assigned assertion's stated constraints exactly.
- **Auth:** membership re-verified server-side via a shared `lib/auth/require-membership.ts` helper (defense in depth alongside RLS); role-gated actions re-check the specific role server-side, never relying on the UI hiding a button.
- **Errors:** caught, logged to Sentry, generic safe message returned to the client — raw DB errors never surfaced.
- **Cache:** targeted `revalidatePath`/`revalidateTag` (two-argument form, Next.js 16) for exactly the routes this mutation affects.
- **Performance:** p95 < 500ms at v1-scale data.

## Definition of done

- **Primary success test:** appropriate to feature type — unit test for pure logic (migrations/utilities), integration test for Server Actions touching Supabase, end-to-end (Playwright) only for interaction-heavy assertions (e.g. F090's board reorder).
- **Failure test:** the negative case is asserted explicitly within the same test suite as the happy path (e.g. non-member calling an action, invalid input, cross-workspace access attempt).
- **Manual verification:** none beyond the automated test — per discovery Q26 (critical paths only), the validation contract itself is the sign-off criterion for a solo MVP.
- **Side effects:** where the feature touches workspace-scoped data, the test asserts no other workspace's rows are mutated or returned.
- **Evidence artifact:** test output (pass) referencing the assertion ID by name is the non-negotiable minimum; a screenshot/log line is added where it adds real signal (e.g. Playwright trace for F090).
