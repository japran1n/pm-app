# F008 Clarification

_Generated: 2026-08-17T21:45:00Z_  _Mode: accept-and-continue_
_Answered by: orchestrator, on standing user authorization — ★ defaults taken for all 20 questions, no interactive round._

## Round A - 10 task questions

**1. Implementation pattern**
_How is this UI feature structured?_
- (a) Server Component for data-fetching + a thin Client Component only for interactivity, per AS-155's SSR requirement  ★ recommended — chosen
- (b) fully Client Component, fetched via useEffect
- (c) fully static, no data
- (d) a mix with no clear boundary

**2. Rendered states**
_What states must this component visibly handle?_
- (a) loading (Suspense/skeleton), populated, empty, and error — all four explicitly, not just the happy path  ★ recommended — chosen
- (b) populated only
- (c) populated + empty, no explicit loading/error UI
- (d) undefined, implementation decides ad hoc

**3. Loading state design**
_What does the loading state look like?_
- (a) a skeleton matching the final layout's shape (shadcn Skeleton component)  ★ recommended — chosen
- (b) a spinner
- (c) blank/nothing until data arrives
- (d) a full-page loading screen

**4. Responsive breakpoints**
_How does this component behave at mobile width, given the desktop-first priority (discovery Q14)?_
- (a) remains usable (readable, scrollable, tappable) but is not the primary design target — no dedicated mobile layout beyond Tailwind's default responsive stacking  ★ recommended — chosen
- (b) a fully separate mobile layout
- (c) hidden entirely on mobile
- (d) not tested at mobile width at all

**5. Failure / error handling**
_If the underlying data fetch fails, what does the user see?_
- (a) a generic inline error state with a retry action; the real error is logged to Sentry, not shown raw  ★ recommended — chosen
- (b) a blank screen
- (c) a browser-native error page
- (d) a toast only, content area stays blank with no explanation

**6. Empty / zero state**
_What's shown when there's no data yet?_
- (a) an explicit empty-state message with a clear next action, per the assigned assertion's empty-state requirement  ★ recommended — chosen
- (b) nothing rendered
- (c) a loading spinner forever
- (d) a generic 'no data' with no guidance

**7. Validation rules**
_N/A at the pure-rendering level — validation lives in the Server Action(s) this component calls, per the 'action' feature type's Q7._
- (a) n/a  ★ recommended — chosen
- (b) n/a
- (c) n/a
- (d) n/a

**8. Performance budget**
_Target for this view's perceived load?_
- (a) primary content server-rendered and visible in initial HTML (AS-155); interactive within the project-wide <500ms p95 budget (AS-156) for the data it depends on  ★ recommended — chosen
- (b) no specific target
- (c) <100ms
- (d) not a priority yet

**9. Auth / access control**
_Is this component/route itself gated beyond the layout-level workspace-membership guard (F010/F023)?_
- (a) no additional gate — relies on the workspace layout guard already in place; role-specific actions inside it are individually gated per their own Server Action  ★ recommended — chosen
- (b) yes, a separate page-level check duplicating the layout guard
- (c) no guard at all, relies only on RLS
- (d) undefined

**10. Dependencies on existing code**
_What existing components/actions does this feature compose?_
- (a) shadcn/ui primitives from components/ui/ plus the domain Server Action(s) already implemented in its milestone  ★ recommended — chosen
- (b) entirely new primitives, not using shadcn/ui
- (c) a third-party component library not in tech-decisions.md
- (d) undefined until implementation

## Round B - 5 follow-ups

**1. Component library boundary**
_compose from components/ui/ (shadcn) primitives only — no new low-level primitive unless shadcn has no equivalent_
- (a) shadcn primitives only  ★ recommended — chosen
- (b) custom component for everything
- (c) a mix, worker's discretion
- (d) a different UI kit entirely

**2. Client/Server boundary granularity**
_the smallest possible Client Component wrapping only the interactive part (e.g. the drag handle, the dropdown), not the whole page_
- (a) smallest possible client boundary  ★ recommended — chosen
- (b) whole page as Client Component for simplicity
- (c) no client components, fully static
- (d) undefined

**3. Toast/notification usage**
_sonner (shadcn's toast) for transient success/error feedback on mutations_
- (a) sonner toast  ★ recommended — chosen
- (b) inline banner only
- (c) browser alert()
- (d) no feedback UI

**4. Icon set**
_lucide-react exclusively, per tech-decisions.md libraries-used_
- (a) lucide-react  ★ recommended — chosen
- (b) a mix of icon sets
- (c) inline SVGs hand-written
- (d) emoji

**5. Keyboard/focus behavior**
_dialogs/sheets trap focus and return it to the trigger on close (Radix/shadcn default — do not override)_
- (a) default Radix focus trap, unmodified  ★ recommended — chosen
- (b) custom focus management
- (c) no focus management
- (d) undefined

## Round B - 5 "definition of done"

**1. Primary success test**
_What test proves the happy path for this feature's assigned assertion(s)?_
- (a) unit test on the core function/action
- (b) integration test (DB + Server Action)
- (c) end-to-end (Playwright)
- (d) combination appropriate to the feature type (unit for pure logic, integration for Server Actions touching Supabase, e2e only for F090/F150-class interaction assertions)  ★ recommended — chosen

**2. Failure test**
_What test proves error handling / the negative case for this feature's assertion(s)?_
- (a) unit test on each error branch
- (b) integration test forcing failure (e.g. non-member calling the action)
- (c) chaos test (random failures injected)
- (d) error paths tested via the same integration test as the happy path, asserting the negative case explicitly  ★ recommended — chosen

**3. Manual verification**
_What does a human check before sign-off, if anything, for a solo-vibe-coder MVP (discovery: critical paths only)?_
- (a) none beyond the automated test — the validation contract IS the sign-off criterion  ★ recommended — chosen
- (b) a 3-step manual script in the feature spec
- (c) a live demo
- (d) checking log lines from a real run

**4. Side-effect verification**
_What should NOT happen as a result of this feature, and how is that checked?_
- (a) the test asserts no other workspace's data is mutated or returned (cross-workspace isolation), where the feature touches workspace-scoped data; otherwise N/A  ★ recommended — chosen
- (b) snapshot test of all affected tables
- (c) no explicit check
- (d) test verifies no other endpoint's behavior changes

**5. Evidence artifact**
_What proves this feature is done in the handoff/milestone report?_
- (a) test output (pass) referencing the assertion ID by name, per worker.md's test-naming convention
- (b) a screenshot or short screen recording
- (c) log lines from a real local run
- (d) all of the above where feasible; test output is the non-negotiable minimum  ★ recommended — chosen
