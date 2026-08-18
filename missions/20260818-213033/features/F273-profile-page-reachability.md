# F273: make the profile settings page reachable

**Milestone:** M10 — Foundation v2 & identity primitives (follow-up from M10 scrutiny)
**Estimated worker time:** 45 minutes
**Depends on:** F123, F122
**Parent feature:** F123 (inherits its clarification)

## Assertion IDs covered
- AS-202: display name replaces the email everywhere a person is rendered

## Why this exists
M10 scrutiny FAIL: the settings page, its loading state and its form all work, but nothing in the app links to `/w/<slug>/settings/profile`. A user cannot set a display name without typing the URL, so AS-202 cannot hold in practice. See `missions/20260818-213033/milestones/M10-scrutiny.md` § AS-202.

## Draft scope
- Add a user/account entry point in the sidebar footer: the signed-in person's `UserAvatar`, their resolved display name, a Profile link, and the existing Sign out, or a Settings nav group containing Profile and Members.
- Playwright test that signs in, navigates from the workspace root to the profile page by clicking (no hardcoded URL), sets a display name, and asserts that name renders on a task card or in the members list.
- While there: drop the now-redundant email subtitle at `settings/members/page.tsx:166-168` and `time/page.tsx:207-209`, and decide whether the members list keeps showing the email once a display name exists.

## Files (approximate)
components/nav/app-sidebar.tsx, app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx, app/(workspace)/w/[workspaceSlug]/time/page.tsx, tests/e2e/profile-settings.spec.ts (new)

## Clarified implementation
- Inherits F123's clarification (archetype: ui). The entry point uses existing primitives; no new component family.
- The Playwright test is the assertion's real evidence — a source-text check does not count.

## Definition of done
- A signed-in user can reach the profile page by clicking only.
- The e2e test proves the set name renders on a person-rendering surface.
- `npm run test`, `npx tsc --noEmit`, `npx eslint .` clean.
