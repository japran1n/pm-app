# F002b: Regenerate database types and remove the `untyped()` escape hatch

**Milestone:** M1
**Estimated worker time:** 1–1.5 h
**Depends on:** F001, F002
**Opened by:** the orchestrator, after verifying F002's handoff

## Why this exists

`lib/supabase/database.types.ts` is stale — it does not contain
`project_phases` at all, and it predates F001's columns on `tasks`,
`projects` and `project_statuses`.

F002 worked around this by adding a local helper in
`lib/actions/phases.ts`:

```ts
function untyped(admin: AdminClient): SupabaseClient { … }
```

which erases the schema types on a **service-role** client. F002's
handoff justified this as "matching `lib/actions/docs.ts`'s existing
precedent". **That is not accurate:** `docs.ts` contains no such helper,
and `grep -rn "function untyped" lib/` finds exactly one definition —
the new one. The pattern is novel, not precedent.

That matters beyond tidiness. Every remaining milestone adds tables
(`approval_requests`, `client_deliverables`, `project_scope_items`,
`project_decisions`, `retainers`, `project_metrics`, `project_links`, …).
If each feature invents its own cast, the entire portal write surface
runs untyped against a client that bypasses RLS — which is precisely
where a wrong column name or a missing filter does the most damage.

Fix the root cause once, here, before M2 starts.

## Assertion IDs covered

None directly. This is a correctness and maintainability feature that
protects AS-054 and AS-055 by keeping later write paths type-checked.

## Scope

1. **Fix the two pre-existing type errors in `lib/actions/chat-channels.ts`**
   that F002 reported as blocking regeneration. Fix them properly — do
   not suppress with `@ts-expect-error` or widen a type to `any`. If a
   fix turns out to need a schema change, stop and say so in the
   handoff instead of forcing it.
2. **Regenerate `lib/supabase/database.types.ts`** from the linked
   project with the Supabase CLI (the MCP is not authorised in this
   session). Check whether the repo already has a script for this; if
   not, add one to `package.json` next to `db:apply` so the next person
   does not have to rediscover the command.
3. **Remove `untyped()` from `lib/actions/phases.ts`** and let the
   regenerated types flow through. Every call site must type-check
   without a cast.
4. If any other file gained a similar cast during F001/F002, remove it
   too.

## Files (approximate)

- `lib/supabase/database.types.ts`
- `lib/actions/chat-channels.ts`
- `lib/actions/phases.ts`
- `package.json`

## Notes

- Regenerating types can surface further pre-existing errors elsewhere.
  Fix what is genuinely broken; if you find something that needs a real
  design decision, leave it, document it in the handoff, and say which
  file it is in. Do not let this feature grow into a repo-wide cleanup.

## Definition of done

- **Primary success test:** `npx tsc --noEmit` is clean with no
  `untyped()` helper anywhere in `lib/`.
- **Failure test:** deliberately misspell a column name in one
  `project_phases` query and confirm the compiler now catches it, then
  revert. Say in the handoff that you did this.
- **Manual verification:** `grep -rn "function untyped" lib/` returns
  nothing; `grep -c "project_phases" lib/supabase/database.types.ts`
  returns a non-zero count.
- **Side-effect verification:** F002's own tests still pass
  (`tests/integration/f002-phase-management.test.ts` and the phase
  optimistic test), plus the chat tests touching `chat-channels.ts`.
