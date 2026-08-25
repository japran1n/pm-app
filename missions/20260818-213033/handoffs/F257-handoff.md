# Handoff: F257 — route-level error boundaries

## Status
COMPLETE

## Assertions covered
AS-500: PASS — an error in one view does not blank the whole app shell. Added `error.tsx` to every one of the 19 data-fetching route segments under `app/(workspace)/w/[workspaceSlug]/**/` that F255's handoff enumerated (same route list, reused verbatim), plus a root `app/error.tsx` fallback. Each boundary sits *below* `app/(workspace)/w/[workspaceSlug]/layout.tsx` in the render tree (Next.js only replaces the failing segment's own children, never a parent layout), so the sidebar/nav shell stays mounted when a segment throws. New tests: `test_AS_500_*` (22 cases: one render+no-leak test per boundary, one retry/`reset()` test, one "renders no sidebar of its own" documentation test) in `tests/unit/route-error-boundaries.test.tsx`, all passing.

## Files changed
components/route-error.tsx (new — shared client component: icon, plain-language message, "Try again" button wired to `reset()`, `console.error`s the real error for dev visibility, never renders `error.message` or stack to the DOM)
app/error.tsx (new — root shell fallback, wraps `RouteError` in a centered container; not `global-error.tsx`, so it still renders inside `app/layout.tsx`)
app/(workspace)/w/[workspaceSlug]/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/archive/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/calendar/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/my-tasks/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/notifications/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/projects/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/columns/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/search/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/settings/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/settings/audit/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/settings/members/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/settings/profile/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/templates/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/time/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/timeline/error.tsx (new)
app/(workspace)/w/[workspaceSlug]/trash/error.tsx (new)
tests/unit/route-error-boundaries.test.tsx (new)

## Commands run
`npx vitest run tests/unit/route-error-boundaries.test.tsx` (0 — 22/22 tests passed)
`npx tsc --noEmit` (0, no output)
`npx eslint .` (0 errors, 6 warnings — same 6 pre-existing warnings documented in F255/F252's baseline: `lib/queries/search.ts:280`, `tests/unit/invite-member-pagination.test.ts:186`, `tests/unit/palette-actions-recents.test.tsx:55×2,74×2` — none added by this feature; removed one `eslint-disable-next-line no-console` I'd added defensively that eslint flagged as unused since `no-console` isn't a configured rule in this repo)
`npx vitest run tests/unit` (149 files / 1159 tests passed; 1 pre-existing unrelated unhandled-rejection error from `tests/unit/user-avatar.test.tsx` — the same documented `cookies() outside request scope` flake from `comment-list`'s mention-candidate effect that F255's and later handoffs already recorded — unrelated to this feature, does not fail the run)
`npx next build` (0 — "Compiled successfully", all 29 routes generated, including all 19 error-boundary-covered routes plus the root `/` and `app/error.tsx` fallback; no new build warnings)

No Playwright run: this feature is a pure structural error-boundary wiring change with no new interactive flow beyond a button whose only job is calling a prop function (`reset`) — exercised directly and deterministically in the jsdom unit test via `fireEvent.click` + `vi.fn()` assertion, which is the precise, falsifiable form of "retry calls `reset()`, not a local re-render" that AS-500 needs. A live Playwright test would need to force a real Server Component throw and is not more informative than asserting the `reset` prop is invoked (Next.js itself owns re-invoking the failed render when `reset()` fires — that machinery is framework-internal, not this feature's code to test).

## Decisions made
- Reused the exact 19-route enumeration from F255's handoff (same `app/(workspace)/w/[workspaceSlug]/**/` fetching routes) rather than re-deriving it, per this feature's spec explicitly pointing at F255's list. Deliberately did NOT add an `error.tsx` to `t/[taskKey]/page.tsx`, matching F255's own documented reasoning for skipping `loading.tsx` there: that route's entire body is a resolve-then-redirect/notFound with no persistent content of its own, so an error boundary there would catch nothing meaningfully different from the destination `board/error.tsx` (already covered) taking over after redirect. If this route's resolver logic itself throws before redirecting, the nearest error.tsx up the tree (`app/(workspace)/w/[workspaceSlug]/error.tsx`) still catches it — no gap.
- Built one shared `components/route-error.tsx` Client Component and had every per-route `error.tsx` file be a ~15-line wrapper passing `error`/`reset` straight through, per the clarified "reuse a shared error-display primitive if it reduces duplication" instruction and the ambiguity-resolution rule (simpler option, no new dependency, no second source of truth — one shared component rather than 20 hand-written markup blocks).
- `RouteError` never renders `error.message` or `error.stack` — only a fixed, generic sentence ("Something went wrong" / a one-sentence plain-language description). The real `Error` object is only ever passed to `console.error` inside a `useEffect` (dev-visible only, never sent anywhere), consistent with the spec's explicit "no external error-reporting service (Sentry etc.)" out-of-scope note — there is no network call or third-party SDK involved at all, just a local `console.error`.
- The retry button calls the `reset` prop directly (`onClick={() => reset()}`), not a locally-managed "retry" boolean — this is the concrete implementation of the clarified requirement that "retry must actually re-run the failed fetch, not just re-render the same failed state": Next.js's `reset()` re-mounts the error boundary's segment, which re-invokes the Server Component (and therefore the data fetch that threw), which a local state toggle could never do since the thrown-error subtree is already unmounted from React's perspective.
- `app/error.tsx` (not `app/global-error.tsx`): the spec asks for "a global `app/error.tsx` fallback for the root shell itself," which is the file Next.js actually names `app/error.tsx` — it catches errors in `app/page.tsx` and any segment without a closer boundary, and still renders inside `app/layout.tsx`'s `<html>/<body>`. `global-error.tsx` is a different, more drastic mechanism (replaces the root layout itself, requires its own `<html>/<body>`) reserved for errors in the root layout, which is out of scope per the spec's literal wording.
- Test strategy: rendered each `error.tsx` module directly (not through a real Next.js error-throwing render pass, which vitest/jsdom can't simulate) with a synthetic `Error` containing a deliberately identifiable message/stack, and asserted that identifiable string never appears in `document.body.textContent` — this is the falsifiable, automatable form of "never a raw stack trace or error.message exposed directly to the user" that's actually testable outside a browser, mirroring F255's precedent of testing structural render output directly rather than requiring a live server.

## Out-of-scope work needed
None identified. Every fetching route segment under `app/(workspace)/w/[workspaceSlug]/**/` (per F255's enumeration) now has an `error.tsx`, plus the root `app/error.tsx`. `t/[taskKey]` intentionally has none, matching F255's precedent and documented above — any error thrown there before its redirect is still caught by the nearest parent boundary.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No manual browser-preview screenshots were captured. The definition-of-done's "Manual verification" answer calls for screenshots "for UI features" at desktop/375px, but the actual thing to verify — a route throwing and the boundary rendering in place while the sidebar survives — requires deliberately forcing a Server Component to throw in a live running app, which this worker has no scripted hook for in this codebase (same class of limitation F255's handoff documented for `loading.tsx` under artificial network delay). Substituted with the `tests/unit/route-error-boundaries.test.tsx` suite, which renders each boundary directly with a synthetic error and asserts (a) the shared fallback markup/copy renders, (b) the raw error message/stack never appears in the DOM, (c) the retry button calls `reset()`, and (d) the boundary itself renders no sidebar/nav markup (documenting that the shell's persistence is the parent layout's job, not this component's) — the falsifiable, automatable proxy for AS-500 that doesn't require a live browser session.

## Notes for the next worker
- `components/route-error.tsx` is now the one shared error-display primitive for this app; if a future feature needs a route-specific error message (e.g. "Board couldn't load" instead of the generic "Something went wrong"), pass the optional `title`/`description` props rather than hand-rolling new markup.
- No MCP tools used — pure UI/route-scaffolding feature with no live schema/policy surface, matching the spec's "MCP at run: none."
- If a future feature adds a new fetching route under `app/(workspace)/w/[workspaceSlug]/**/`, it should get both a `loading.tsx` (F255's pattern) and an `error.tsx` (this feature's pattern, just import and re-export `RouteError`) — there's no lint rule enforcing this pairing, so it's a page-owning-team responsibility per F255's precedent note.
