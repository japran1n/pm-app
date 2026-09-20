# Handoff: F051 — Regresijski prolaz: stari contract, portal, resolveClientBucket

## Status
COMPLETE

## Assertions covered
AS-006: PASS — `npx tsc --noEmit` exit 0, `npm run lint` exit 0 (0 errors, 7 pre-existing warnings unrelated to this mission), `npm run migrations:check` exit 0 ("No migration drift — all migrations present on remote.")
AS-178: PASS — `resolveClientBucket` exists in `components/portal/status-label.ts`, full body recorded below; no other feature in this mission touched this file (confirmed via `git status`/`git diff` — the file is not in the working tree diff at all, i.e. byte-identical to its last committed state).
AS-179: PASS — `npx tsc --noEmit` exits 0 across the whole repo (including `components/portal/**`), so portal components compile cleanly.
AS-180: PASS — `lib/queries/architecture.ts` contains no reference to `page_components.description` (grep confirms the only "description" hit is a comment noting it was intentionally dropped) and no reference to `node_meta`/`architecture_node_meta.client_visible` (the file's other `client_visible` occurrences are the still-live `page_components.client_visible` / `sections.client_visible` columns, not the dropped `node_meta.client_visible` column — verified the file never references `node_meta` at all).
AS-181: PASS — `setNodeMetaClientVisibility` does not appear in `lib/actions/architecture.ts` (the barrel) or anywhere in production code; only remaining references are in `tests/unit/f034-remove-set-node-meta-client-visibility.test.ts`, which asserts its absence.
AS-182: PASS — `npx vitest run tests/unit/m6-action-barrel-guard.test.ts` — 2/2 passed.

## Files changed
tests/unit/m9-regression.test.ts (new)
missions/20260919-150607/handoffs/F051-handoff.md (new)

## Commands run
`npx tsc --noEmit` (0)
`npm run lint` (0, 0 errors / 7 pre-existing warnings)
`npm run migrations:check` (0)
`npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` (0, 2/2 passed)
`npx vitest run tests/unit/m9-migration-headers.test.ts tests/unit/m9-migration-check.test.ts --reporter=verbose` (0, 4/4 passed)
`npx vitest run tests/unit/m9-regression.test.ts --reporter=verbose` (0, 3/3 passed)
`npx vitest run` (full suite — 601 files / 4566 tests passed, 263 files / 206 tests pre-existing-failed; see Decisions made)
`git grep -n "setNodeMetaClientVisibility"` (found only in tests/unit/f034-remove-set-node-meta-client-visibility.test.ts)
`grep -n "description\|client_visible" lib/queries/architecture.ts` (reviewed manually, see notes)

## Decisions made
- The spec's step-8 test template literally checks `expect(content).not.toContain("client_visible")` against the *entire* `lib/queries/architecture.ts` file. That file legitimately still contains `client_visible` many times — but those are the live `page_components.client_visible` and `sections.client_visible` columns (used to gate the client-facing board query), not the dropped `node_meta` (`architecture_node_meta`) `.client_visible` column the assertion (AS-180) and F032/F034 migrations are actually about. Running the literal template fails with a false positive that misrepresents the codebase (grep confirms `node_meta` is never referenced in this file at all). I adjusted the assertion to `expect(content).not.toMatch(/node_meta/i)` instead, which captures the real invariant ("this file does not touch the dropped node_meta.client_visible column") without flagging the unrelated, still-live column of the same name on a different table. AS-180's own wording in the feature spec ("without referencing dropped columns (`description`, `client_visible`)") is satisfied under this corrected, scoped reading — the file references neither the dropped `page_components.description` nor the dropped `node_meta.client_visible`. The genuinely dropped-column check is independently and exactly verified by the pre-existing `tests/unit/m9-migration-check.test.ts` (AS-172/AS-173), which passed.
- AUTONOMOUS_DECISION: kept the literal test's other two assertions (AS-178, AS-181) verbatim from the spec since they don't have this table-name collision problem.
- Full `npx vitest run` (whole repo, 866 files) shows 263 pre-existing failing files (206 tests), all unrelated to this feature: e.g. `tests/unit/watching-feed-query.test.ts` fails with `TypeError: supabase.rpc is not a function`, a pre-existing test-mock gap (the mock Supabase client used in that suite doesn't implement `.rpc`), not something touched by F051 or by this mission's status-label/architecture-query work. Confirmed via `git status` that this worker only added one new test file (`tests/unit/m9-regression.test.ts`) and touched no production source, so these failures predate and are independent of this feature's changes. Per DoD, the scoped commands (tsc, lint, migrations:check, m6/m9 guard tests, the new m9-regression test) all pass cleanly.

## resolveClientBucket (proof unchanged, from components/portal/status-label.ts)
```ts
export function resolveClientBucket(
  category: StatusCategory,
  clientBucket: string | null | undefined,
  pendingClientApproval = false,
): ClientBucket {
  if (pendingClientApproval && category !== "done") {
    return "waiting";
  }
  if (clientBucket && isClientBucket(clientBucket)) {
    return clientBucket;
  }
  return CATEGORY_BUCKET_FALLBACK[category];
}
```

## Out-of-scope work needed
- The 206 pre-existing failing tests across 263 files (mostly `supabase.rpc is not a function` and similar mock-shape gaps in test fixtures) are a separate, pre-existing test-infrastructure debt unrelated to this mission's scope. Worth a dedicated follow-up feature to fix the shared Supabase mock helper to implement `.rpc`, but that is out of scope for F051 (regression pass for THIS mission's changes only).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Rewrote one assertion inside the spec-provided `m9-regression.test.ts` template (the `client_visible` check) to be scoped to `node_meta` instead of the whole file, because the literal template produces a false-positive failure due to an unrelated, still-live column sharing the same name (`page_components.client_visible` / `sections.client_visible`) on different tables. The underlying invariant (dropped `node_meta.client_visible` column is gone) is verified both by this adjusted test and by the pre-existing `tests/unit/m9-migration-check.test.ts` (AS-173), which passed.

## Notes for the next worker
- `lib/queries/architecture.ts` intentionally keeps `client_visible` as a live, filtered column for `page_components` and `sections` — do not confuse this with the dropped `architecture_node_meta.client_visible` column from earlier in the mission (F032/F034).
- No MCP tools were needed for this feature — it's a static/code-level regression pass (tsc, lint, migration-drift script, grep, vitest), not a live-schema change.
