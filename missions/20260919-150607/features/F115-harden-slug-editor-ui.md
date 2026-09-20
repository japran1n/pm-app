# F115 — Harden slug editor UI + add tests

_Mission: 20260919-150607_ _Milestone: M7 follow-up (scrutiny-1 FU-3 blocker)_

## Problem

F044's `PageColumnHeader` slug editor has zero tests and code defects:
1. No `router.refresh()` after save — slug can appear stale
2. `onBlur` silently discards typed slug (different from title field's save-on-blur)
3. Error `<p>` has no `role="alert"`, no `aria-describedby`, input has no `aria-invalid`
4. Pending flag discarded — double-submit possible, rejected promise leaves no feedback
5. No trim before sending, no no-op guard for unchanged slug
6. `pageSlug` typed as `string` but can be `null` — renders bare `/` and `aria-label="Edit slug: undefined"`

## Fix

### 1. Fix `components/architecture/page-column-header.tsx`

- Add `router.refresh()` call after successful save (matching renamePage handler pattern)
- Remove `onBlur={() => setIsEditingSlug(false)}` — replace with either explicit Cancel button or explicit save-on-blur (DECISION: save-on-blur matching title field; if empty/unchanged, cancel without saving)
- Add `role="alert"` + `id="slug-error-{page.id}"` on error `<p>`, wire `aria-invalid`/`aria-describedby` on input
- Consume the pending flag: `const [isSlugPending, startSlugTransition] = useTransition()` — disable input while pending
- Wrap action call in `try/catch`, show toast on rejection via `toast.error(...)`
- Trim value before sending, skip action call if value equals current slug
- Fix null guard: only render slug display when `page.pageSlug != null`

### 2. Write `tests/unit/f044-page-column-slug-editor.test.tsx`

Use React Testing Library + vitest. Mock `@/lib/actions/architecture` and `next/navigation`.

Tests:
- AS-147: renders slug below title when `page.pageSlug` is non-null
- AS-147: does NOT render slug when `page.pageSlug` is null
- AS-148: clicking slug button sets edit mode (shows Input with current slug value)
- AS-148: typing new slug + Enter calls `changePageSlug(page.id, trimmedValue)`
- AS-148: successful save exits edit mode (Input disappears, slug button reappears with new value after refresh)
- AS-148: failed save shows error message inline
- AS-148: Escape exits edit mode without calling changePageSlug

## Assertions: AS-147, AS-148

## Verification
```
npx vitest run tests/unit/f044-page-column-slug-editor.test.tsx --reporter=verbose 2>&1
npx tsc --noEmit 2>&1 | head -10
npx eslint components/architecture/page-column-header.tsx tests/unit/f044-page-column-slug-editor.test.tsx --max-warnings=0 2>&1 | tail -5
```

## Commit
`feat(F115): harden slug editor + a11y + tests [AS-147, AS-148]`

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>

## Handoff
`missions/20260919-150607/handoffs/F115-handoff.md`
