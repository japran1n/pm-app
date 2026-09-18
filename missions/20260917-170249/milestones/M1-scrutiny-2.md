# M1 — Foundation — Scrutiny report (re-run #2)

_Mission: 20260917-170249_ _Validator: scrutiny (adversarial, read-only)_
_Date: 2026-09-17_ _Tree: `18f608bc`_
_Verdict: **GREEN** — all three original blockers are genuinely fixed and
mutation-verified independently. Three **majors** remain (see below); none
block the milestone gate._

Scope of this re-run: the three follow-up features (F043, F044, F045) plus a
re-check of every M1 assertion. No code, test, or contract file was modified;
all mutation testing was done in a throwaway detached git worktree, which was
removed afterwards (`git status` on `app/`, `components/`, `lib/`, `tests/` is
clean).

## Verdict table

| Assertion | Verdict | Reason |
|---|---|---|
| AS-001 | PASS | Item is in the unconditional `work` array; `getByRole("link", {name: /^Webflow$/})` requires a real accessible name, and emptying the label turns 10/10 tests red. |
| AS-002 | PASS | Route file exists with a default export; unchanged since scrutiny #1. |
| AS-003 | **PASS (was blocker)** | `tests/unit/workspace-layout-membership-denial.test.ts` calls `WorkspaceLayout` directly with the converter page as `children` and a null `activeWorkspace`. Independently mutation-verified three ways, all red: deleting `notFound()`, replacing it with `redirect("/sign-in")`, and disabling the `if (!activeWorkspace)` condition. Real guard logic, not source mirroring. |
| AS-004 | PASS | `tests/unit/proxy-auth-guard.test.ts:34` now names the route explicitly (`requiresAuth("/w/acme/tools/webflow")`), plus the layout's own `!user → redirect` path. |
| AS-005 | **PASS (was major)** | Placement is now asserted structurally: the link's group wrapper must have no `<p>` heading and must contain the Dashboard link as a sibling. Mutation-verified: moving the item into the labelled `other` group turns the placement test red. |
| AS-006 | **PASS with a residual gap (was blocker)** | The `bg-accent` tautology is gone. Active state asserts `aria-current="page"` + `font-medium` + `not text-muted-foreground` on the `<a>` itself, with a real negative case at `/w/acme`, on both desktop and mobile. Mutation-verified: collapsing the active branch to the inactive class string turns 2 tests red. **Gap:** no nested-subpath case — see M-2. |
| AS-007 | **PASS behaviourally, test incomplete (major)** | Guest-render cases on both surfaces are real (gating on `isGuest` turns 2 tests red). But every test renders `workspaceSlug: "acme"` only — see M-1. |
| AS-008 | **PASS (was blocker)** | `tests/unit/f004-webflow-tool-portal-isolation.test.ts` now sweeps `components/portal/**` and portal-named `lib/**` in addition to `app/(portal)/**`, with a self-check asserting `portal-sidebar.tsx` is actually in the swept set, and an explicit documented exemption for `components/nav/app-sidebar.tsx`. Mutation-verified: planting a `tools/webflow` reference in `components/portal/portal-sidebar.tsx` (the exact file scrutiny #1 said would slip through) turns it red, as does planting one in `app/(portal)/portal/[workspaceSlug]/layout.tsx`. |
| AS-009 | PASS (minor) | Unchanged. Behaviour correct by reading (the page has no imports at all); the guarding regex is still leaky. Carried as FU-6. |
| AS-010 | **INCONCLUSIVE (unchanged, major)** | Still unverifiable at this milestone — there is no editor to load empty. Must not be counted green until F027/F029 land. Carried as FU-6. |
| AS-127 | **FAIL — major (was major)** | Partially addressed and still not covered — see M-3. |

Score: 9 PASS, 1 FAIL (major), 1 INCONCLUSIVE. **0 blockers.**

## The three original blockers — confirmed closed

All three were re-verified adversarially, from the code alone, without
reading the workers' handoffs:

1. **FU-1 / AS-003.** Three independent mutations of
   `app/(workspace)/w/[workspaceSlug]/layout.tsx` each produce a red test.
   The previous complaint — "deleting the layout's guard leaves all four
   tests green" — no longer holds.
2. **FU-2 / AS-006.** The self-satisfying `toContain("bg-accent")` assertion
   is gone, replaced with `font-medium` (active-branch-only) plus an explicit
   negative assertion on `text-muted-foreground` scoped to the `<a>`'s own
   `classList`, not its icon child. The mobile `<Sheet>` is genuinely opened
   and asserted against, closing the "only the desktop copy is ever matched"
   gap. `afterEach(cleanup)` is present; the dangling `vi.doMock` is gone.
3. **FU-3 / AS-008.** The sweep now matches or exceeds the F009 pattern that
   the earlier milestone's scrutiny established. The regression against that
   recorded finding is reversed.

## Remaining majors

**M-1 (major, AS-007) — the "every workspace" claim is never exercised with a
second workspace.** Every test in `app-sidebar-webflow-nav.test.tsx` renders
`workspaceSlug: "acme"`, and every href assertion is against the literal
string `/w/acme/tools/webflow`. I mutated line 159 of
`components/nav/app-sidebar.tsx` to a hardcoded `"/w/acme/tools/webflow"`
(dropping the `${workspaceSlug}` interpolation) — **all 10 tests still pass.**
A hardcoded or mis-derived slug is the single most likely way "available
identically in every workspace" actually breaks, and nothing catches it. A
default-on prop or membership-flag toggle (`webflowEnabled ?? true`) would
likewise pass; `useMembership` is not mocked in this file at all.

**M-2 (major, AS-006) — nested-subpath active highlighting is uncovered, and
FU-2 explicitly asked for it.** FU-2's spec named "a nested-path case at
`/w/acme/tools/webflow/results`". It was not added. I verified the
consequence: adding `exact: true` to the Webflow nav entry — a plausible
copy-paste from the adjacent Dashboard entry — leaves **all 10 tests green**
while silently breaking highlighting on every converter sub-route. Likewise,
replacing the `exact ? === : startsWith` logic with a bare `pathname === href`
leaves all 10 green. The prefix-match branch of the active-state logic is
completely untested for this item. This matters as soon as M2 adds any
sub-route under `tools/webflow`.

**M-3 (major, AS-127) — theming/legibility is still not verified; the test
renamed the assertion rather than covering it.** The describe block restates
AS-127 as "renders an actual icon element (Code2 SVG), not just token classes"
— which is not what AS-127 claims. FU-2 asked to "widen the match to include
the icon"; an `svg` presence + `aria-hidden` check was added, but the icon's
*colour token* is still never asserted. I mutated the icon's class from
`text-muted-foreground` to `text-tertiary-foreground` — a token CLAUDE.md
explicitly forbids for anything the user must read — and **all 10 tests still
pass.** No theme is rendered, no token resolved, no contrast computed. The
one theming-ish assertion, `expect(link).toHaveClass("text-muted-foreground")`,
is made on the *inactive* link and simply duplicates the AS-006 negative case;
it is implementation-mirroring filler. Note also that
`components/nav/app-sidebar.tsx:459` renders the icon at
`text-muted-foreground` even on the *active* link whose label is
`text-foreground`, so the active item's icon is deliberately lower-contrast
than its label in both themes — exactly the territory AS-127 polices, and
nothing notices.

**M-4 (minor, AS-008) — two carried-over nits from FU-3 not done.** (a) Line
34 still uses `join("tools","webflow")`, which yields `tools\webflow` on
Windows and would silently disarm test 1 there; FU-3 asked for a literal
forward slash. (b) The sweep still cannot see a leak introduced via a shared
component outside `components/portal/**` (e.g. `components/shared/**`) that
the portal renders. Neither is a gate issue on Linux/macOS CI.

## FU-4 (integration baseline) — resolved, and the root cause checks out

Scrutiny #1 rejected the "sandbox has no network" excuse, correctly. F046's
replacement explanation is different and **I independently confirmed it**:
`tests/setup/testing-library.ts:38-40` writes
`NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321"` whenever the variable
isn't exported to the shell, so `tests/integration/**` dials a local Supabase
stack that isn't running — hence `TypeError: fetch failed`, not a network
outage. Exporting the real `.env` values instead produces a *different*
outcome: the same suite now refuses to run at all with an explicit guard
("Tests are pointed at a hosted Supabase project…"), confirming these suites
are designed for an ephemeral `supabase start` stack, exactly as
`.github/workflows/ci.yml` runs them. This is a real, reproducible mechanism
and is not a regression from this mission. FU-4 is closed. The 173 failures
are out of scope per the milestone mandate.

## Recommended follow-up features

**FU-7 — Parameterise the sidebar nav tests over workspace slug (major,
AS-007).** Wrap the existing render helper in a `describe.each` over at least
two distinct slugs (e.g. `acme` and `globex`) and assert the href is
`/w/${slug}/tools/webflow` in each, derived from the fixture rather than
written as a literal. The acceptance criterion is a mutation, not a green run:
replacing `` `/w/${workspaceSlug}/tools/webflow` `` with a hardcoded
`"/w/acme/tools/webflow"` in `components/nav/app-sidebar.tsx` must turn the
suite red. While there, add a case that renders with a mocked membership
object carrying no Webflow flag, so a future default-on toggle cannot be
introduced invisibly.

**FU-8 — Cover nested-subpath active highlighting (major, AS-006).** Add the
case FU-2 already specified and F044 skipped: set `currentPath` to
`/w/acme/tools/webflow/results` and assert the Webflow link carries
`aria-current="page"` and `font-medium`. Acceptance is mutation-verified:
adding `exact: true` to the Webflow nav entry, and separately collapsing the
`isActive` expression to `pathname === href`, must each turn this test red.
Additionally assert that Webflow's active class string is identical to another
top-level item's (e.g. Projects) so "the same active-route styling as other
sidebar items" is compared rather than assumed.

**FU-9 — Make AS-127 a real theming assertion, or de-scope it honestly
(major, AS-127).** Assert the icon element's own `className` carries a
semantic token that resolves in both theme blocks — the cleanest form is a
test that reads the resolved `--muted-foreground` (and whatever token the icon
uses) out of the app's theme CSS for both `:root` and `.dark`, fails if either
is undefined, and computes an APCA/WCAG contrast against the corresponding
surface token. Minimum acceptable: assert the icon carries
`text-muted-foreground` (not `text-tertiary-foreground`, which CLAUDE.md bans
for operative content) and that both themes define that token. Acceptance is
mutation-verified: swapping the icon token must turn the test red. Also decide
deliberately whether the active item's icon should lift to `text-foreground`
alongside its label; today it does not, and that is a legibility decision no
one has made on the record. If contrast genuinely cannot be asserted in jsdom,
route AS-127 to the UX validator explicitly rather than leaving a jsdom test
claiming to cover it.

**FU-10 — Portal sweep hardening (minor, AS-008).** Replace
`join("tools","webflow")` with the literal `"tools/webflow"` in both halves of
`tests/unit/f004-webflow-tool-portal-isolation.test.ts`, and extend the
portal-file filter to include shared component directories that the portal's
render tree actually imports (resolve `app/(portal)/**`'s transitive
`@/components/...` imports rather than filtering by path substring), so a leak
planted in `components/shared/**` is caught too.

**FU-6 (carried, unchanged) — Re-test AS-010 once the editor exists, and turn
AS-009 into an import-graph check.** Verbatim from scrutiny #1; still open.
AS-010 must remain flagged not-yet-covered until F027/F029 land.

**FU-5 (carried, minor) — Retire the vendor-only dependency smoke test** once
M2's engine modules exist, and move it under `tests/unit/`.

---

## Appendix A — mutation testing transcript

All runs in a detached worktree at `18f608bc` with `node_modules` symlinked;
worktree removed afterwards. Baselines: sidebar 10/10 pass, layout 1/1 pass,
portal 2/2 pass.

### `tests/unit/app-sidebar-webflow-nav.test.tsx`
```
mutation                                          result
------------------------------------------------  ---------------------------
move item into labelled `other` group             1 failed |  9 passed   CAUGHT
active branch -> inactive class string            2 failed |  8 passed   CAUGHT
gate item on `isGuest`                            2 failed |  8 passed   CAUGHT
remove the <Icon> element                         2 failed |  8 passed   CAUGHT
empty the `label` (href still says webflow)      10 failed |  0 passed   CAUGHT
hardcode href to "/w/acme/tools/webflow"         10 passed             MISSED
icon token -> text-tertiary-foreground           10 passed             MISSED
add `exact: true` to the Webflow entry           10 passed             MISSED
isActive -> bare `pathname === href`             10 passed             MISSED
```

### `tests/unit/workspace-layout-membership-denial.test.ts`
```
mutation                                          result
------------------------------------------------  ---------------------------
delete the `notFound()` call                      1 failed              CAUGHT
`notFound()` -> `redirect("/sign-in")`            1 failed              CAUGHT
disable the `if (!activeWorkspace)` condition     1 failed              CAUGHT
```

### `tests/unit/f004-webflow-tool-portal-isolation.test.ts`
```
mutation                                          result
------------------------------------------------  ---------------------------
plant `tools/webflow` in components/portal/
  portal-sidebar.tsx                              1 failed | 1 passed   CAUGHT
plant `tools/webflow` in app/(portal)/portal/
  [workspaceSlug]/layout.tsx                      1 failed | 1 passed   CAUGHT
```

## Appendix B — full toolchain output

### `npx tsc --noEmit -p .`
```
(no output)
exit 0
```

### `npm run lint`
```
> pm-app@0.1.0 lint
> eslint

(no output)
exit 0
```

### `npx vitest run --exclude "tests/integration/**" --reporter=dot`
```
 Test Files  474 passed | 1 skipped (475)
      Tests  3113 passed | 3 skipped (3116)
```
(+1 file, +8 tests vs scrutiny #1 — F043's new file and F044's rewritten one.)

### `tests/integration/**` — out of scope per mandate, root cause confirmed
```
$ npx vitest run tests/integration/db-task-keys.test.ts          # env not exported
  -> TypeError: fetch failed   (dials http://127.0.0.1:54321, per
     tests/setup/testing-library.ts:38-40)

$ set -a; . ./.env; set +a; npx vitest run tests/integration/db-task-keys.test.ts
  -> Test Files  1 failed | Tests  no tests
     "Tests are pointed at a hosted Supabase project (...)"   [explicit guard]
```
Confirms these suites target an ephemeral local `supabase start` stack, as
`.github/workflows/ci.yml` runs them. Not a regression from this mission.
