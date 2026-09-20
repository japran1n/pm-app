# F051 — Regresijski prolaz: stari contract, portal, resolveClientBucket

_Mission: 20260919-150607_ _Milestone: M9_ _Depends on: F049, F050_

## Svrha

Završni regresijski prolaz koji dokazuje da ništa iz ove misije nije pokvarilo već-uspostavljene invarijante.

## Tvrdnje

- **AS-006**: tsc exits 0, lint exits 0, migrations:check exits 0 (all four AS-006 legs)
- **AS-178**: `resolveClientBucket` in `components/portal/status-label.ts` is byte-identical to the pre-mission version (CLAUDE.md: "must never be changed")
- **AS-179**: Portal builds without TypeScript errors (portal components compile cleanly)
- **AS-180**: Architecture board query (`lib/queries/architecture.ts`) still returns `page_kind`, `page_slug`, and `page_components` without referencing dropped columns (`description`, `client_visible`)
- **AS-181**: No production component file imports from the dropped columns or removed actions (`setNodeMetaClientVisibility`)  
- **AS-182**: The M6 guards (`tests/unit/m6-action-barrel-guard.test.ts`) still pass — every exported action has a real call site, EXPECTED_ACTION_COUNT is correct

## Clarified implementation

1. Run `npx tsc --noEmit` — exit 0. Record in handoff.
2. Run `npm run lint` — exit 0 (warnings OK, 0 errors). Record in handoff.
3. Run `npx supabase migration list` — all local = remote.
4. Check `components/portal/status-label.ts` — find `resolveClientBucket` and verify it matches the expected implementation (has not been modified by this mission). Record the function signature/body in handoff.
5. Grep `lib/queries/architecture.ts` — confirm no references to `description` column or `client_visible` column.
6. Grep codebase for `setNodeMetaClientVisibility` — must not appear in any non-test, non-handoff file.
7. Run `npx vitest run tests/unit/m6-action-barrel-guard.test.ts tests/unit/m9-migration-headers.test.ts tests/unit/m9-migration-check.test.ts --reporter=verbose` — all pass.
8. Write a test `tests/unit/m9-regression.test.ts` that:
   - Asserts `status-label.ts` contains `resolveClientBucket` (not that it's identical, but that it still exists and contains expected key strings)
   - Asserts `setNodeMetaClientVisibility` does NOT appear in `lib/actions/architecture.ts` barrel
   - Asserts `page_components.description` does NOT appear in `lib/queries/architecture.ts`
9. Commit and write handoff.

## Definition of done

- All 4 AS-006 commands pass
- resolveClientBucket exists unchanged
- No stale column references in queries
- m9-regression tests pass
- tsc + lint clean
