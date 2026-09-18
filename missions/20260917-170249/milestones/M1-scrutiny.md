# M1 — Foundation — Scrutiny report

_Mission: 20260917-170249_ _Validator: scrutiny (adversarial, read-only)_
_Date: 2026-09-17_ _Verdict: **FAIL** — milestone does not pass._

Features in scope: F001 (dependency), F002 (route skeleton), F003 (sidebar nav
item), F004 (portal-isolation test).

## Verdict table

| Assertion | Verdict | Reason |
|---|---|---|
| AS-001 | PASS | Item lives in the `work` array, the only nav group never passed through `filterGuest`, so no role gate can reach it; route exists and adds no auth of its own. Weak evidence only (see notes). |
| AS-002 | PASS | `app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx` exists with a default export; the test's `readFileSync` genuinely fails if the file moves. |
| AS-003 | **FAIL — blocker** | Denial is real but lives entirely in the parent layout. Deleting the layout's `if (!activeWorkspace) { notFound() }` block leaves all four F002 tests green. The only AS-003 evidence is a negative regex asserting the page does *not* duplicate auth logic — it says nothing about whether the inherited guard exists. |
| AS-004 | PASS | Two independent guards: `proxy.ts` `requiresAuth` (`pathname.startsWith("/w/")` → `/sign-in`) and the layout's `if (!user) redirect("/sign-in")`. `tests/unit/proxy-auth-guard.test.ts` exercises the prefix rule behaviourally and it is path-generic, so this route is covered by construction. |
| AS-005 | **FAIL — major** | Implementation correct, test vacuous. `expect(html).toContain("Webflow")` is satisfied by the href substring alone even if the label were deleted, and nothing asserts *which group* the item is in. Moving the item under `other` (next to Settings) leaves the test green — the exact regression AS-005 names. |
| AS-006 | **FAIL — blocker** | The assertion is self-satisfying: the test checks `toContain("bg-accent")`, but the **inactive** class string is `"text-muted-foreground hover:bg-accent"`, which contains `bg-accent`. The assertion passes for an inactive link. Dropping `bg-accent text-foreground font-medium` from the active branch while keeping `aria-current` — precisely the styling regression AS-006 guards — is invisible. No negative case, no nested-path case. |
| AS-007 | PASS | The nav entry is unconditional, unlike the `hasClient`-gated and `canManageWorkspace`-gated siblings; the guest-render test covers the strictest gate. |
| AS-008 | **FAIL — blocker** | The F004 test is not a tautology (mutation-verified: planting a route and planting a link under `app/(portal)` are both caught), but its scope is wrong. It filters to `f.includes(join("app","(portal)"))`, and the portal's entire nav item list lives **outside** that tree in `components/portal/portal-sidebar.tsx`. Adding a Webflow entry to that array would put the converter link on every client-facing portal screen with the test still green. This is a regression against a documented prior finding — `tests/unit/f009-legacy-portal-route-redirects.test.ts` lines 94–104 record the M2 scrutiny finding that scoping to `app/(portal)`/`components/portal`/`lib/portal` "let exactly that kind of offender through"; F004 narrowed to a *stricter* scope than the one already proven insufficient. |
| AS-009 | PASS (minor) | Verified by reading the file, not the test: the page has no imports at all — no Supabase client, no `fetch`, no env read. The test's guard is leaky (it would not catch `getWorkspaceProjects` imported from `@/lib/queries/*`, which is how this codebase actually reaches Supabase) but the behaviour is correct today. |
| AS-010 | **INCONCLUSIVE — major** | Unverifiable at this milestone: there is no editor on the page, so "returns to an empty editor state" cannot be exercised. The test substitutes `expect(source).not.toContain("await ")` — pure source-mirroring that also trips on the word "await" in a comment and passes on `void loadPriorSession()` or a client child restoring from a server on mount. Must not be counted green until F027/F029 land. |
| AS-127 | **FAIL — major** | Nothing about theming or legibility is verified. The test asserts `toContain("text-muted-foreground")` — the exact string the component writes. No theme is rendered, no token resolved, no contrast computed. Worse, the regex captures only the opening `<a ...>` tag, while the icon is a separate `<Icon className="size-4 shrink-0 text-muted-foreground" />` element outside the match — so the assertion cannot fail on the icon at all, though AS-127 names the icon explicitly. |

Score: 5 PASS, 5 FAIL (3 blocker, 2 major), 1 INCONCLUSIVE.

## What the code actually does

A static Server Component at `/w/[workspaceSlug]/tools/webflow` renders a
heading and one line of copy. It has no imports and performs no I/O; every
access-control behaviour attributed to it is inherited from
`app/(workspace)/w/[workspaceSlug]/layout.tsx`, which redirects
unauthenticated visitors to `/sign-in` and collapses "workspace missing" and
"not a member" into a single `notFound()` via a membership-scoped RLS query.
`components/nav/app-sidebar.tsx` gains one unconditional entry in the `work`
group linking to that path, with `Code2` as its icon and prefix-matched
active highlighting. `node-html-parser@9.0.4` is added to `dependencies`
(correct, not devDependencies) and pinned by the committed lockfile. No
conversion logic exists anywhere yet.

The access-control behaviour is, as far as I can tell by reading, **correct**.
The failures above are almost entirely a testing failure: the assertions are
guarded by regexes over source text that restate what the implementation
writes, so they would survive the very regressions they exist to catch.

## Toolchain results

- `npx tsc --noEmit -p .` — **exit 0, clean.**
- `npm run lint` (eslint) — **exit 0, clean.**
- `npx vitest run --exclude "tests/integration/**"` — **473 files passed, 1 skipped; 3105 tests passed, 3 skipped.** Green.
- `npx vitest run tests/integration` — **252 files failed, 6 passed; 173 tests failed, 42 passed, 1684 skipped.** All failures are `TypeError: fetch failed` reaching Supabase.

### The integration-failure explanation in the handoffs is false

F001, F002, F003 and F004 all assert these 173 failures are a pre-existing
sandbox limitation with no network. F001's handoff states it was "confirmed
via a network probe in this sandbox: `curl https://example.com` also fails
with no network." **That is not true in this environment.** I measured:

- `curl https://example.com` → HTTP 200.
- `curl $NEXT_PUBLIC_SUPABASE_URL/rest/v1/` → HTTP 401 (host up, key required).
- A plain `node -e` script loading `.env` and calling `fetch()` against the same
  Supabase URL → HTTP 401.

So both the network and the Supabase project are reachable; the stated root
cause is wrong, and no worker actually established one.

Worse, an A/B against the pre-mission tree does not support "pre-existing".
Using a detached worktree at `27545719` (the commit immediately before F001)
with the same `.env`/`.env.local` and the same `node_modules`, alternating
checkouts twice:

```
27545719 run1: Tests  12 passed (12)
0204527b run1: Tests  12 failed (12)     # 0204527b = feat(F001)
27545719 run2: Tests  12 passed (12)
0204527b run2: Tests  12 failed (12)
```

(`tests/integration/db-task-keys.test.ts`, which touches nothing this
milestone changed.) The split is deterministic and tracks the tree, not time
or rate limiting. Reverting `package.json` alone or `package-lock.json` alone
at the F001 tree does *not* restore green; adding only F001's new test file to
the baseline tree does *not* turn it red. I could not isolate a mechanism —
and the two worktrees necessarily shared one `node_modules` (and therefore one
Vite dep-optimisation cache), which is a confound I could not remove cheaply.
I am therefore recording this as **INCONCLUSIVE but serious**, not as a proven
regression. What *is* proven is that the justification all four handoffs used
to ship past 173 red tests does not hold, and the milestone cannot be accepted
on it.

## Recommended follow-up features

**FU-1 — Behavioural membership-denial test for the converter route
(blocker, AS-003).** Add a test that renders `WorkspaceLayout` with the
converter page as `children` and `params: Promise.resolve({ workspaceSlug:
"not-mine" })`, mocking `getCurrentUser` to return a user and
`getWorkspaceBySlug` to return `null`, asserting `notFound()` was called;
`tests/integration/workspace-not-found-scope.test.ts` is the template. The
acceptance criterion is a mutation test, not a green run: deleting the
layout's `if (!activeWorkspace)` block must make this test fail. While there,
add `expect(requiresAuth("/w/acme/tools/webflow")).toBe(true)` to
`tests/unit/proxy-auth-guard.test.ts` so AS-004 is named by a test somewhere
rather than only covered by construction.

**FU-2 — Make the sidebar assertions falsifiable (blocker, AS-006; major,
AS-005/AS-127).** Rewrite `tests/unit/app-sidebar-webflow-nav.test.tsx` so
each assertion can fail. For AS-006, assert a token unique to the active
branch (`font-medium`) *and* `not.toContain("text-muted-foreground")`, add a
negative case at pathname `/w/acme/projects` where the Webflow anchor must
carry neither `aria-current` nor the active classes, and add a nested-path
case at `/w/acme/tools/webflow/results`. For AS-005, parse the rendered nav
into groups and assert the item appears in the unlabeled first group after
Projects, with no group heading preceding it. For AS-127, widen the match to
include the icon element, which the current regex cannot reach at all. Also
assert both rendered instances (desktop `<aside>` and mobile `<Sheet>`) —
today only the first anchor is ever matched, so a sheet-only regression is
invisible. Add an `afterEach` restoring the `vi.resetModules()`/`vi.doMock()`
left dangling in test 2.

**FU-3 — Widen the portal-isolation sweep to the whole tree (blocker,
AS-008).** Remove the `app/(portal)` filter from
`tests/unit/f004-webflow-tool-portal-isolation.test.ts` and scan all of
`app`/`components`/`lib` (the walk already collects them), keeping the
existing `"(workspace)"` directory exclusion, which exempts the legitimate
route file by rule. Exempt `components/nav/app-sidebar.tsx` by explicit path
with a comment, the way F009 exempts its legacy redirect pages. Adopt F009's
established pattern rather than a narrower one — the narrowing is a
regression against that milestone's own recorded scrutiny finding. Also fix
the comment block at lines 45–51, which claims the sweep covers "the shared
components/lib the portal pulls from" when the code discards exactly those
files, and make `tools/webflow` matching use a literal forward slash in both
halves (`join()` yields `tools\webflow` on Windows, silently disarming test 1).

**FU-4 — Establish the real cause of the 173 integration failures and record
a true baseline (blocker for the milestone gate).** Before M2 proceeds,
determine why `tests/integration/**` fails with `TypeError: fetch failed`
when the same URL is reachable from `curl` and from a plain `node` fetch, and
whether the tree-correlated A/B above survives a clean, non-shared
`node_modules` in each arm. The likely candidates are the Vite
dep-optimisation cache keyed on `package.json`, and the fact that these suites
are designed to run against an ephemeral local stack (`supabase start`, per
`.github/workflows/ci.yml`) rather than the hosted project. Produce a
documented, reproducible baseline so future handoffs can cite a measured
number instead of asserting an unverified environment excuse. No handoff in
this mission should again be accepted on the claim that the sandbox has no
network.

**FU-5 — Retire the vendor-only smoke test when engine code lands (minor).**
`lib/webflow-converter/dependency.test.ts` does assert real behaviour
(`tagName`, `querySelector`, text extraction, empty-input contract) and would
fail against a broken parser, so it is an honest dependency canary. But it
tests the vendor library, not project code, and will pass forever regardless
of whether the converter is ever correct. Replace it — not merely supplement
it — once M2's engine modules exist, and move it under `tests/unit/` to match
every other test in the repo.

**FU-6 — Re-test AS-010 once the editor exists (major).** AS-010 is currently
guarded by `not.toContain("await ")` and is not meaningfully covered. When
F027/F029 land, replace it with a real assertion: render the assembled
converter and assert the editor inputs are empty on load with no network call
for prior content. Track AS-010 as not-yet-covered until then. Separately,
AS-009's two negative regexes should become an import-graph check asserting the
page's transitive imports reach no `@/lib/supabase` or `@/lib/queries` module
and contain no `fetch`/`process.env` reference — the current regex misses the
realistic regression.

Note on AS-001/AS-007: the sidebar component has no role concept at all, only
`isGuest` and `canManageWorkspace` booleans, so "owner, admin, member" all
collapse to a single code path. The assertions hold, but the orchestrator may
want a `describe.each` over `{isGuest, canManageWorkspace, hasClient}` so the
"always present" claim is exercised rather than asserted in a comment.

AS-011 and AS-012 are in the AS-001–AS-012 access block but are assigned to
later features; they are not evaluated here.

---

## Appendix — full toolchain output

### `npx tsc --noEmit -p .`
```
(no output)
exit 0
```

### `npm run lint`
```
> pm-app@0.1.0 lint
> eslint

exit 0
```

### `npx vitest run --exclude "tests/integration/**" --reporter=dot` (tail)
```
stderr | tests/unit/portal-approvals-query.test.ts > getOpenApprovalsForClient — F079 defect 1: a failed read is not an empty list > test_open_approvals_failed_read_returns_ok_false_not_an_empty_array
[error] getOpenApprovalsForClient: failed to load approval requests { error: { message: 'connection reset' } }

stderr | tests/unit/portal-approvals-query.test.ts > getApprovalHistory — F079 defect 1: a failed read is not an empty list > test_approval_history_failed_read_returns_ok_false_not_an_empty_array
[error] getApprovalHistory: failed to load approval history { error: { message: 'connection reset' } }

stderr | tests/unit/portal-approvals-query.test.ts > getDecisionOwners — F079 defect 1: a failed read is not an empty list > test_decision_owners_failed_read_returns_ok_false_not_an_empty_array
[error] getDecisionOwners: failed to load decision owners { error: { message: 'connection reset' } }

(node:68593) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.

stderr | tests/unit/team-projects-for-member-query.test.ts > getProjectsForMember > throws when the underlying read fails
[error] getProjectsForMember: fetch failed { error: { message: 'connection reset' } }

stderr | tests/unit/notification-preferences-filter.test.ts > F211 filterRecipientsByInAppPreference > test_AS_391_fails_open_and_keeps_everyone_on_a_preferences_read_error
[error] filterRecipientsByInAppPreference: preferences read failed (fail-open, non-fatal) { error: { message: 'boom' } }

 Test Files  473 passed | 1 skipped (474)
      Tests  3105 passed | 3 skipped (3108)
   Start at  18:16:18
   Duration  89.31s (transform 8.63s, setup 65.58s, import 110.78s, tests 60.82s, environment 75.00s)
```
(The `stderr` lines above are deliberate error-path tests asserting fail-open
and ok:false behaviour — they are expected log noise from passing tests, not
failures.)

### `npx vitest run tests/integration --reporter=dot` (tail)
```
 Test Files  252 failed | 6 passed (258)
      Tests  173 failed | 42 passed | 1684 skipped (1899)
   Start at  18:17:56
   Duration  80.78s (transform 2.55s, setup 8.62s, import 10.61s, tests 232.55s, environment 308ms)
```

Representative failure:
```
Error: Failed to seed workspace: TypeError: fetch failed
    101|       if (error || !ws) {
    102|         throw new Error(`Failed to seed workspace: ${error?.message}`);
```

### Network reachability probes (contradicting the handoffs)
```
$ curl -s -o /dev/null -w "%{http_code}" --max-time 8 https://example.com
200   (exit 0)

$ curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/"
401

$ node -e '<load .env; fetch(NEXT_PUBLIC_SUPABASE_URL + "/rest/v1/")>'
URL host: qcipqonnqajmazdbysow.supabase.co
ok 401
```

### A/B against the pre-mission tree (`tests/integration/db-task-keys.test.ts`)
Detached worktree, same `.env` and `.env.local`, shared `node_modules`:
```
27545719 run1: Tests  12 passed (12)
0204527b run1: Tests  12 failed (12)
27545719 run2: Tests  12 passed (12)
0204527b run2: Tests  12 failed (12)
```
Isolation attempts (all at the F001 tree unless noted):
```
revert package.json only        -> Tests  12 failed (12)
revert package-lock.json only   -> Tests  12 failed (12)
baseline tree + F001's new test -> Tests  12 passed (12)
```
Worktree removed afterwards; `git status` confirms no source file was modified
by this validation.
