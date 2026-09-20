# M7 Scrutiny — RED

Mission 20260919-150607 · Milestone M7 (F041, F042, F043, F044) · 2026-09-20
Adversarial review. Read-only; no code, test, or contract was modified.

## Verdict: **RED**

5 of 12 assertions fail. 1 is inconclusive. The action's happy path is
correct code; the *tests* for the two assertions that carry the most risk
(project-scoping and non-cascading) are vacuous, and the entire UI feature
(F044 / AS-147, AS-148) has zero automated coverage of any kind.

## Assertion table

| ID | Status | Severity | Reason |
|---|---|---|---|
| AS-138 | PASS | — | `changePageSlug` re-exported at `lib/actions/architecture.ts:19`; barrel guard test (AS-130) additionally proves it has a real call site. |
| AS-139 | PASS | — | `changePageSlugSchema` = `{ taskId: uuid, slug: min(1).max(200).regex(slugPattern) }`; both simple and nested (`services/seo`) slugs parse. |
| AS-140 | PASS | minor | Empty / >200 / uppercase / spaces / non-uuid all rejected, plus a 200-char boundary case. Whitespace-padding case missing (see AS-140 note below). |
| AS-141 | **FAIL** | **blocker** | The "same slug in a different project is allowed" test proves nothing — it only sets `duplicateRow = null`. Deleting `.eq("project_id", …)` from `pages.ts:415` (making uniqueness global — the exact bug the assertion exists to prevent) leaves every test green. |
| AS-142 | PASS | major | Unauthenticated caller is rejected, but the test mutates a module-level `currentUser` and relies on `cache()` not memoizing outside a request scope — fragile against a React upgrade. |
| AS-143 | PASS | — | `canWrite` false → `"Viewers don't have permission…"`, no update issued. |
| AS-144 | **FAIL** | major | The update mock records the filter *value* but discards the *column* (`eq: vi.fn((_col, matchId) => …)`). Changing `.eq("id", taskId)` to `.eq("project_id", taskId)` — which would rewrite every page in the project — passes all three side-effect tests. |
| AS-145 | PASS | — | Genuinely exact: `expect(payload).toEqual({ page_slug: "new-slug" })`. A regression adding `position`/`page_order` fails. |
| AS-146 | **FAIL** | **blocker** | The test asserts only the payload value and `matchId`; that is identical for a correct implementation and a cascading one. The stated intent ("not a wildcard that could cascade") is never exercised. Same discarded-column hole as AS-144. |
| AS-147 | **FAIL** | major | Slug *is* rendered below the title (`page-column-header.tsx:222-234`) — but no test anywhere renders it. Separately, `BoardPage.pageSlug` is typed `string` via an unchecked `as string` cast at `lib/queries/architecture.ts:157` over a `string \| null` column, so a null slug renders a bare `/` and an a11y name of `"Edit slug: undefined"`. |
| AS-148 | **FAIL** | **blocker** | Zero tests. Three of four clauses are defective in code (see F044 defects below): the saved slug never re-renders, the error is inaccessible and silently discarded on blur, and there is no double-submit or rejection handling. |
| AS-149 | **FAIL** | **blocker** | Only half the assertion is covered. `next/cache` is mocked but never imported or inspected — **no test asserts `revalidatePath` was called**. Deleting `pages.ts:451-461` entirely keeps the suite green. |

## Key defects

### D1 — Test mocks discard filter columns (AS-141, AS-144, AS-146) · blocker
`tests/unit/m7-change-page-slug.test.ts:56-81`. `buildSelectChain` defines
`eq`/`is` as identity stubs that record nothing, and `buildAdminMock`'s
update path captures only the second positional arg. The select branch is
chosen by *whether `.neq()` was called*, not by the filters. Consequently
no test can distinguish project-scoped from global uniqueness, nor an
`id`-scoped update from a `project_id`-scoped cascading one. Nothing asserts
`.is("deleted_at", null)` either — dropping it would make soft-deleted pages
block slug reuse forever, invisibly.

### D2 — `revalidatePath` unasserted (AS-149) · blocker
`revalidatePath`, `revalidatePortalProject`, and the `extractWorkspaceSlug`
array/object branch at `pages.ts:389-392` have no coverage at all.

### D3 — Saved slug does not appear in the UI (AS-148) · blocker
`page-column-header.tsx:100-108` omits the `router.refresh()` that the
sibling `renamePage` handler calls at line 144, relying solely on the
action's `revalidatePath("/w", "layout")`. The board receives `pages` as
server props, so the displayed slug can stay stale after a successful save.
Deliberately diverging from the pattern two functions above, uncommented.

### D4 — Slug editor error/blur/concurrency handling (AS-148) · blocker
Same file, lines 87-110 and 236-250:
- `onBlur={() => setIsEditingSlug(false)}` silently discards a typed slug with no save and no warning, while the adjacent title field *saves* on blur. Two neighbouring fields, opposite semantics, no affordance distinguishing them.
- The error `<p>` has no `role="alert"`, no `id`, no `aria-describedby`/`aria-invalid` on the input — a straight regression against the title editor 50 lines up, which has all four.
- The pending flag is discarded (`const [, startSlugTransition] = useTransition()`), the input is never disabled, and there is no `try/catch` around the action call. Holding Enter fires N concurrent calls; a rejected promise (network/transport failure) leaves `slugError` null and the editor open with no feedback whatsoever.
- No trim and no client-side pre-validation, so `" home "` round-trips to the server and returns the full three-clause regex message into a `text-xs` line.

### D5 — No DB-level uniqueness constraint (AS-141) · major
`grep` across `supabase/migrations` finds no unique index on `page_slug`;
`20260909010000_portal_foundations.sql:73` adds the column bare. The
read-then-write in `pages.ts:412-441` is the only enforcement, with a network
round-trip between SELECT and UPDATE. Two concurrent renames to the same slug
both see `null` and both commit. `createPage` has the identical hole.

### D6 — Silent error path · major
`pages.ts:378-385` collapses `taskError`, missing row, null `page_slug`, and
missing `projects.workspace_id` into `"Page not found."` and **never logs
`taskError`** — unlike the two later error paths at 422 and 444. A real DB
failure is indistinguishable from a bad id and leaves no trace.

### D7 — Schema diverges from its own stated sibling · minor
`lib/validation/architecture.ts:87-94` omits the `.trim()` that
`createPageSchema.slug` (line 29-37) has, despite the comment at 80-84
claiming the shape "mirrors" it. `.max(200)` therefore runs on an untrimmed
string. A page creatable as `"my-page "` cannot be renamed to the visually
identical value.

### D8 — Stale TODO · minor
`pages.ts:1075-1081` still reads `TODO(F042): changePageSlug server action
lands here`, ~700 lines below the implemented action.

## Recommended follow-up features

**FU-1 — Make the changePageSlug mocks record query filters (blocker).**
Rewrite the chainable builder in `tests/unit/m7-change-page-slug.test.ts` so
every `eq`/`is`/`neq` on both the select and update paths pushes an exact
`(column, value)` tuple into a recorded list, and have the uniqueness-query
fixture answer *per `project_id`* rather than returning a fixed
`duplicateRow`. Then assert: the uniqueness SELECT carries
`project_id = <task's project>`, `page_slug = <new slug>`, `id != taskId`, and
`deleted_at is null`; and the UPDATE carries exactly one filter, `id = taskId`.
Add a regression case with two projects where the same slug exists in the
other project and must be allowed, and a case proving a cascading
`.eq("project_id", …)` update would fail. This closes AS-141, AS-144 and
AS-146, none of which are currently falsifiable.

**FU-2 — Assert the revalidation half of AS-149 (blocker).**
Import the mocked `next/cache` and `@/lib/actions/portal-revalidate` in the
M7 action test and assert `revalidatePath` is called with `("/w", "layout")`
on success and not called on any failure path (invalid input, unauthenticated,
viewer, duplicate slug, update error). Add coverage for
`revalidatePortalProject` including the `extractWorkspaceSlug` array-shaped
join result and the null-workspace-slug branch, which are wholly untested.
Also drive the `existingPageError` and `updateError` branches by making the
mock return an error, since both currently hardcode `error: null`.

**FU-3 — Harden and test the inline slug editor (blocker).**
Add `tests/unit/f044-page-column-slug-editor.test.tsx` rendering
`PageColumnHeader` and asserting: the slug appears below the title; clicking
it enters edit mode seeded with the current slug; Enter calls `changePageSlug`
with `(page.id, value)`; a failing result renders the message inline; Escape
exits without calling the action. Alongside, fix the component: call
`router.refresh()` after a successful save (matching `renamePage`); give the
error `role="alert"` + `id` and wire `aria-invalid`/`aria-describedby` on the
input; consume the `useTransition` pending flag to disable the input and
prevent double-submit; wrap the action call in `try/catch` and surface a toast
on rejection; trim the value before sending; short-circuit a no-op save; and
decide blur semantics deliberately (save-on-blur like the title field, or an
explicit cancel affordance) rather than silently discarding input.

**FU-4 — Fix the `pageSlug` null lie (major).**
`lib/queries/architecture.ts:157` casts a nullable `page_slug` to `string`
with `as string` while the row type at line 81 declares `string | null`.
Either make `BoardPage.pageSlug` honestly `string | null` and render an
explicit "no slug set" affordance, or filter null-slug rows out of the page
list at the query boundary. Today a null slug renders a bare `/` as a 1-char
click target and an accessible name of `"Edit slug: undefined"`; fixtures in
`tests/unit/f005-task-detail-sheet-page-fields.test.tsx:228` already encode
`pageSlug: null`, so this is reachable, not hypothetical.

**FU-5 — Add a DB-level uniqueness constraint (major).**
Add a migration creating
`unique index … on tasks (project_id, page_slug) where page_slug is not null
and deleted_at is null`, and handle Postgres `23505` in both `changePageSlug`
and `createPage`, mapping it to the existing "A page with this slug already
exists." message. Without it AS-141 is best-effort only: two concurrent
renames both pass the read-then-write check and both commit.

**FU-6 — Log the lookup failure and tidy (minor).**
Log `taskError` and the `requireActiveMembership` failure in `changePageSlug`
(and the analogous spot in `changePageKind`) before returning the generic
message, so a DB fault is distinguishable from a bad id. Add `.trim()` to
`changePageSlugSchema.slug` to match `createPageSchema`, add a
whitespace-padding schema test for AS-140, use `parsed.data.taskId`
consistently instead of the raw argument, and delete the stale
`TODO(F042)` block at `pages.ts:1075-1081`.

---

## Command output

### `npx tsc --noEmit`
```
(no output — exit code 0)
```

### `npx vitest run tests/unit/m7-change-page-slug-schema.test.ts tests/unit/m7-change-page-slug.test.ts tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose`
```
 ✓ tests/unit/m7-change-page-slug-schema.test.ts > changePageSlugSchema > AS-139: parses a valid uuid taskId with a simple slug 1ms
 ✓ tests/unit/m7-change-page-slug-schema.test.ts > changePageSlugSchema > AS-139: parses a valid nested slug with forward slashes 0ms
 ✓ tests/unit/m7-change-page-slug-schema.test.ts > changePageSlugSchema > AS-140: rejects an empty slug 0ms
 ✓ tests/unit/m7-change-page-slug-schema.test.ts > changePageSlugSchema > AS-140: rejects a slug longer than 200 characters 0ms
 ✓ tests/unit/m7-change-page-slug-schema.test.ts > changePageSlugSchema > AS-140: accepts a slug at exactly 200 characters 0ms
 ✓ tests/unit/m7-change-page-slug-schema.test.ts > changePageSlugSchema > AS-140: rejects a slug with uppercase letters 0ms
 ✓ tests/unit/m7-change-page-slug-schema.test.ts > changePageSlugSchema > AS-140: rejects a slug with spaces 0ms
 ✓ tests/unit/m7-change-page-slug-schema.test.ts > changePageSlugSchema > AS-140: rejects an invalid taskId that is not a uuid 0ms
 ✓ tests/unit/m7-change-page-slug.test.ts > F042 changePageSlug > AS-138: changePageSlug is exported from the architecture barrel 1ms
 ✓ tests/unit/m7-change-page-slug.test.ts > F042 changePageSlug > AS-141: rejects a slug already used by another page in the same project 1ms
 ✓ tests/unit/m7-change-page-slug.test.ts > F042 changePageSlug > AS-141: allows the same slug when used in a different project 0ms
 ✓ tests/unit/m7-change-page-slug.test.ts > F042 changePageSlug > AS-142: an unauthenticated caller cannot change a page's slug 0ms
 ✓ tests/unit/m7-change-page-slug.test.ts > F042 changePageSlug > AS-143: a viewer without write permission cannot change a page's slug 0ms
 ✓ tests/unit/m7-change-page-slug.test.ts > F042 changePageSlug > AS-149: a successful call updates the page's slug 0ms
 ✓ tests/unit/m7-change-page-slug.test.ts > side-effect isolation (AS-144, AS-145, AS-146) > AS-144: the update call targets only the given taskId and touches no other rows/sections 1ms
 ✓ tests/unit/m7-change-page-slug.test.ts > side-effect isolation (AS-144, AS-145, AS-146) > AS-145: the update payload does not touch position or page_order 1ms
 ✓ tests/unit/m7-change-page-slug.test.ts > side-effect isolation (AS-144, AS-145, AS-146) > AS-146: a nested slug is written verbatim and the update is scoped to the exact taskId, not a wildcard that could cascade to child pages 0ms
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > parses the expected number of exported actions from the barrel 1ms
 ✓ tests/unit/m6-action-barrel-guard.test.ts > AS-130: architecture action barrel guard > every exported architecture action has at least one real import/call reference outside the barrel, leaf modules, and tests 375ms

 Test Files  3 passed (3)
      Tests  19 passed (19)
   Duration  536ms
```
Note: all 19 pass. Per the review directive, passing is not sufficient —
AS-141, AS-144, AS-146 and AS-149 are marked FAIL because the tests would
not fail if the asserted behaviour broke.

### `npx vitest run tests/unit` (full unit suite)
```
 Test Files  9 failed | 487 passed | 1 skipped (497)
      Tests  30 failed | 3278 passed | 3 skipped (3311)
   Duration  84.17s
```
Failing files — **all pre-existing and unrelated to M7** (realtime
subscription harness, portal guards, watching feed):
```
tests/unit/f019-my-tasks-realtime-hook-set-identity.test.tsx
tests/unit/f022-board-realtime-guard-call-site.test.tsx
tests/unit/f027-calendar-realtime-wiring.test.tsx
tests/unit/f039-portal-guards.test.ts
tests/unit/f042-no-approval-lock-comments.test.ts   (a prior mission's F042, not M7's)
tests/unit/f251-list-table-realtime.test.tsx
tests/unit/personal-todo-list-realtime-wiring.test.tsx
tests/unit/undo-toast.test.tsx
tests/unit/watching-feed-query.test.ts
```
Representative error:
```
TypeError: supabase.rpc is not a function
 ❯ Module.getWatchedTasksForUser lib/queries/watching.ts:112:6
 ❯ subscribeWhenAuthenticated lib/realtime/subscribe-when-authenticated.ts:44:6
```
These are outside M7's scope but should be tracked separately — the suite is
not green, which weakens any "tests pass" signal at future milestones.

### `npm run lint`
```
components/code-editor/editor-pane.tsx
  152:5  warning  Unused eslint-disable directive (no problems were reported from 'react-hooks/exhaustive-deps')
scripts/check-cron-health.mjs
  159:9  warning  'cutoffIso' is assigned a value but never used
tests/unit/th-completion-providers.test.ts
  323:21  warning  'registered' is assigned a value but never used
tests/unit/th-editor-lazy.test.tsx
  13:61  warning  'opts' is defined but never used
tests/unit/th-link-interception.test.tsx
  34:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')
tests/unit/th-monaco-editor.test.tsx
  157:7  warning  'configureMonacoCalledBeforeFirstMount' is assigned a value but never used
tests/unit/th-origin-guard.test.ts
  24:3  warning  Unused eslint-disable directive (no problems were reported from 'no-new-func')

✖ 7 problems (0 errors, 7 warnings)
```
No lint findings in any M7 file.
