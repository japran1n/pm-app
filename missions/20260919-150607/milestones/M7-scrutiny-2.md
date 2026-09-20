# M7 Scrutiny — Pass 2 (post F114 / F115)

Verdict: **GREEN**

Method: read production code + tests independently of handoffs, ran the M7 suite,
tsc, eslint, and then applied four destructive mutations to production code to
prove the tests actually bite.

## Assertion table

| ID | Verdict | Reason |
|----|---------|--------|
| AS-138 | PASS | `barrel.changePageSlug` asserted to be a function; M6 barrel-guard test also proves it has a real call site. |
| AS-139 | PASS | Schema parses simple and nested (`a/b`) slugs with a valid uuid taskId. |
| AS-140 | PASS | Rejects empty, >200, uppercase, spaces, non-uuid; accepts exactly 200; whitespace-padded input is trimmed. Mutation: removing `.trim()` fails the trim test. |
| AS-141 | PASS | Filter-recording mock proves the uniqueness select issues `eq project_id`, `eq page_slug`, `neq id`, `is deleted_at null`, with project_id bound to the task's real project. Mutation: deleting the `project_id` filter fails 2 tests. |
| AS-142 | PASS | `currentUser = null` → `success:false`, "signed in", `revalidatePath` not called. |
| AS-143 | PASS | `canWrite=false` → `success:false`, permission message, no revalidate. |
| AS-144 | PASS | Update chain filters asserted to be exactly `[eq id TASK_ID]` and explicitly NOT project_id. Mutation: swapping `.eq("id", taskId)` for `.eq("project_id", …)` fails 3 tests. |
| AS-145 | PASS | Payload asserted `toEqual({ page_slug })` — any extra column (position/page_order/updated_at) fails. |
| AS-146 | PASS | Nested slug written verbatim; filter list equality proves no wildcard/neq that could cascade to child rows. |
| AS-147 | PASS | Slug renders as `/{slug}` only when non-null. Mutation: replacing the `page.pageSlug != null` guard with `true` fails the null test (bare `/` is rendered). |
| AS-148 | PASS | Enter → `changePageSlug(page.id, trimmed)` + `router.refresh()`; failure → `role="alert"` with `aria-invalid="true"` and `aria-describedby` wired to the alert's id, and no refresh; success exits edit mode; Escape exits without calling the action. All five enumerated F115 criteria covered. |
| AS-149 | PASS | Success path asserts `revalidatePath("/w","layout")`; four distinct failure paths (invalid input, unauthenticated, viewer, duplicate slug) each assert `not.toHaveBeenCalled()`. |

No blockers. No majors.

## Minor findings (not assertion failures — no follow-up feature required)

1. **`disabled={isSlugPending}` is untested.** Mutation-verified: deleting that
   prop from the slug `Input` breaks zero tests. The double-submit guard F115
   added is therefore unprotected against regression. Not part of any AS-148
   acceptance criterion, so this is a minor.
2. **`try/catch` + `toast.error` around the action call is untested.** A rejected
   promise from `changePageSlug` is not exercised; deleting the catch block would
   go unnoticed.
3. **`onBlur={saveSlug}` is untested.** Blur-to-save is only covered indirectly
   (the Escape test relies on the no-op guard, not on blur). Also note: after a
   failed save the editor stays open, so a subsequent blur re-invokes `saveSlug`
   and re-issues the same server action — benign (idempotent) but unasserted.

### Suggested follow-up (optional, low priority)
Add three cases to `tests/unit/f044-page-column-slug-editor.test.tsx`: (a) assert
the slug input carries `disabled` while a never-resolving `changePageSlug` promise
is in flight, and that a second Enter does not produce a second action call;
(b) make `changePageSlug` reject and assert `toast.error` fires while the editor
stays open; (c) assert that blurring the input with a changed value calls
`changePageSlug` and that blurring with an unchanged value does not. These close
the three untested branches F115 introduced without touching production code.

## Command output

### `npx vitest run tests/unit/m7-change-page-slug.test.ts tests/unit/m7-change-page-slug-schema.test.ts tests/unit/f044-page-column-slug-editor.test.tsx tests/unit/m6-action-barrel-guard.test.ts`
```
Test Files  4 passed (4)
     Tests  29 passed (29)
```
All 29 named above pass, including the M6 barrel guard (AS-130).

### `npx tsc --noEmit`
```
(no output — clean)
```

### `npx eslint components/architecture/page-column-header.tsx lib/actions/architecture/pages.ts lib/validation/architecture.ts tests/unit/{f044-page-column-slug-editor,m7-change-page-slug,m7-change-page-slug-schema}.test.*`
```
(no output — clean)
```

### Mutation results (production code reverted afterwards; `git diff` on components/ lib/ tests/ is empty)
| Mutation | Tests killed |
|----------|--------------|
| remove `.trim()` from `changePageSlugSchema` | 1 (AS-140 trim) |
| remove `.eq("project_id", taskRow.project_id)` from uniqueness check | 2 (AS-141 x2) |
| change update filter `.eq("id", taskId)` → `.eq("project_id", …)` | 3 (AS-144, AS-146, AS-149) |
| replace `page.pageSlug != null &&` with `true &&` | 1 (AS-147 null) |
| remove `disabled={isSlugPending}` | **0** — see minor finding 1 |
