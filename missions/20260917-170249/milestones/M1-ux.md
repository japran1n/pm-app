# M1 — UX validation report (Foundation)

Mission: 20260917-170249 · Milestone: M1 · Date: 2026-09-17
Validator: UX validator subagent (Playwright MCP, Chromium)
Scope: AS-001, AS-002, AS-003, AS-007 (the behavioural subset of M1).

## Environment / how this was run

- Booted per `tech-decisions.md`: `npm run dev` (Next.js 16.3.5, Turbopack),
  port 3000. **Boot succeeded** (`✓ Ready in 290ms`).
- Real auth against the real linked Supabase project. Seeded, via the admin
  client, three throwaway workspaces (`m1ux-a-*`, `m1ux-b-*`, `m1ux-c-*`)
  and two real auth users: a **member** (active `member` role in workspaces
  A and B) and an **outsider** (owner of C only, no membership in A).
  Sessions established with a real `auth.admin.generateLink` magic link,
  tokens captured from the redirect and injected as the
  `sb-<ref>-auth-token` cookie — the technique already established by
  `tests/e2e/board-reorder.spec.ts`.
- All seeded workspaces, memberships and auth users were deleted afterwards
  (teardown output verified). Dev server stopped. **No project code was
  modified.**
- Evidence: `missions/20260917-170249/milestones/M1-evidence/`.

## Results

| ID | Verdict | Evidence | Reproduction / observation |
|---|---|---|---|
| AS-001 | **PASS** | `M1-evidence/AS-001-sidebar-nav-group.png` | Signed in as a `member`-role user, landed on `/w/<slug>`. The sidebar's **first, unlabelled** nav group contains, in order: Dashboard, My Tasks, Projects, Chat, **Webflow** — above the first labelled group ("Plan"). Clicking "Webflow" navigated to `/w/<slug>/tools/webflow` and rendered the page, so the "can navigate to it from the sidebar" half of the assertion is exercised, not just the "is visible" half. |
| AS-002 | **PASS** | `M1-evidence/AS-002-converter-page.png` | The route is `/w/<slug>/tools/webflow`. HTTP 200, no 404 and no error boundary. Renders inside the normal workspace chrome (sidebar + breadcrumb header) with `<h1>HTML → Webflow converter</h1>` and the sub-line "Paste HTML, CSS, and JS and convert it into Webflow-ready markup." That is the expected M1 skeleton placeholder. |
| AS-003 | **PASS** | `M1-evidence/AS-003-nonmember-404.png`, `M1-evidence/AS-003-signed-out-redirect.png` | Two denial paths checked. (a) **Signed-in non-member:** outsider's session cookie loaded, navigated to workspace A's `/tools/webflow` → **HTTP 404**, rendering the app's generic "404 / Page not found / This page doesn't exist, or you don't have access to it." No converter heading, no workspace name, no sidebar — nothing leaked. (b) **Signed out:** cookies cleared, same URL → redirected to `/sign-in`. Both match the denial behaviour of other `/w/[workspaceSlug]/*` routes (the shared layout's `redirect("/sign-in")` / `notFound()` gate), which is exactly what the assertion demands. |
| AS-007 | **PASS** | `M1-evidence/AS-007-workspace-b-sidebar.png`, `M1-evidence/AS-001-sidebar-nav-group.png` | The same user navigated to a **second** workspace (`m1ux-b-*`). The "Webflow" item is present in the identical position in the identical unlabelled group, pointing at `/w/m1ux-b-*/tools/webflow`. No per-workspace configuration, gate or toggle was encountered in either workspace — the item is unconditional. |

**Score: 4 PASS / 0 FAIL / 0 INCONCLUSIVE.**

## Verdict: GREEN

All four behavioural assertions assigned to M1 pass with evidence.

## Notes and non-blocking observations

- **Assertion coverage caveat (AS-001, roles).** The contract wording for
  AS-001 is "a workspace member with any role (`owner`, `admin`, or
  `member`)". This run exercised the `member` role — deliberately the
  *least* privileged of the three, so `owner`/`admin` visibility follows a
  fortiori given the nav item is rendered unconditionally with no role
  prop. It is not separately screenshotted. Flagging rather than hiding it.
- **Console is clean.** The only browser console errors during the run were
  the two 404s this validator deliberately provoked (AS-003) and one
  pre-existing, unrelated Next.js dev-overlay warning about a script tag in
  a React component (present on other pages too, not introduced by M1).
- The `/w/<slug>/dashboard` path does **not** exist — the workspace home is
  `/w/<slug>`. Noted only because the launch brief implied otherwise; it is
  not a defect.
- M1 is a skeleton milestone by design: the page body is a heading and a
  paragraph. No converter behaviour (paste, convert, copy) exists yet and
  none was tested — those assertions belong to later milestones.

## Suggested fixes

None. Nothing failed.
