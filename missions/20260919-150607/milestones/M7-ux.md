# M7 — Izmjena sluga (Page Slug Change) — UX validation

Method: component-level behavioural validation (vitest + jsdom, real component
mounted, only server action / router / toast mocked) plus code review of
`components/architecture/page-column-header.tsx`. The app is server-rendered
Next.js behind auth + live Supabase data; a live Playwright flow would require
seeded project/page fixtures that do not exist, so the rendered-DOM test suite
is the evidence of record. This is an accepted substitution, not a skipped check
— every observable step of both assertions (visibility, click-to-edit,
Enter-saves, inline error, Escape-cancels) is exercised against the real DOM.

Evidence: `/Users/sasajapranin/Desktop/pm-app/tests/unit/f044-page-column-slug-editor.test.tsx`
Run output: 7/7 passed (`npx vitest run tests/unit/f044-page-column-slug-editor.test.tsx --reporter=verbose`)

| Assertion | Verdict | Evidence | Reproduction |
|---|---|---|---|
| AS-147 | PASS | tests/unit/f044-page-column-slug-editor.test.tsx:77-87 | Render `PageColumnHeader` with `pageSlug: "my-page"` → `/my-page` present in DOM, sibling immediately after the title `<p>` inside the same `min-w-0 flex-1` column (page-column-header.tsx:248-262). With `pageSlug: null` no `/`-prefixed node renders. |
| AS-148 | PASS | tests/unit/f044-page-column-slug-editor.test.tsx:89-161 | Click `/my-page` → Input mounts prefilled with `my-page`. Type `"  new-slug  "` + Enter → `changePageSlug("page-1", "new-slug")` called with trimmed value, then `router.refresh()`, editor closes. With `{success:false, error:"Slug already taken."}` → `role="alert"` renders the message inline below the input, input gets `aria-invalid="true"` and `aria-describedby` pointing at the alert id, and `router.refresh()` is NOT called. Escape after editing → no action call, `/my-page` restored. |

## Verdict detail

**AS-147 — PASS.** The slug is a `font-mono text-xs text-muted-foreground`
button rendered directly below the page title in the header's text column, so
it reads as page metadata, not as an action. The null-slug guard means pages
without a slug show no dangling `/`.

**AS-148 — PASS.** All four behaviours in the assertion are observable and
correct: click-to-edit, Enter-saves-via-`changePageSlug`, inline error, Escape
cancels. Supporting details verified by review:
- `isSlugPending` disables the input, so Enter cannot double-submit.
- `saveSlug` no-ops (closes without calling the action) when the trimmed value
  equals the current slug — this also makes the `onBlur={saveSlug}` safe after
  Escape, because `cancelSlugEditing` resets `slugValue` first.
- A thrown action (network failure) is caught and surfaced via `toast.error`
  rather than crashing the header.

## Notes / non-blocking observations

1. `onBlur={saveSlug}` means clicking away commits the edit. That is a
   defensible choice and consistent with the title rename affordance in the
   same component, but it is not stated in AS-148 and has no test. Not a
   failure of the assertion.
2. On a thrown action the editor stays open with no inline error (only a
   toast); `slugError` is left null. Minor polish, not an assertion breach.
3. `BoardPage.pageSlug` is typed `string` while the component and the data
   both treat it as nullable — the test file works around this with a cast.
   Type-level only; no user-visible effect.

## Suggested fixes (not applied — validator does not modify code)

- Widen `BoardPage["pageSlug"]` to `string | null` in
  `lib/queries/architecture.ts` so the null branch is type-checked instead of
  cast around.
- In the `catch` in `saveSlug`, also `setSlugError("Something went wrong.")`
  so the failure is visible next to the field the user is editing.

## Overall: GREEN
