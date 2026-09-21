# Handoff: F002 — Account menu on avatar

## Status
COMPLETE

## Assertions covered
SB-012: PASS — clicking the avatar row trigger (`aria-label="Account menu"`) in the sidebar footer opens a `role="menu"` popup containing Profile, Settings (role-gated), Theme, and Sign out. Verified with a real DOM click test (`tests/unit/f002-account-menu.test.tsx`, `test_SB_012_account_menu_opens_from_avatar`), including a second test proving Settings is hidden when `canManageWorkspace` is false.
SB-013: PASS — `screen.queryByRole("button", { name: /toggle theme/i })` and `.../{ name: /^sign out$/i }` both return null after rendering `AppSidebar`; the standalone `<ThemeToggle/>` (desktop header + mobile bar) and the footer's plain `<SignOutButton/>` are both removed from the render tree (`test_SB_013_standalone_theme_and_signout_removed`).
SB-014: PASS — clicking the Theme menu item calls the same `next-themes` `setTheme(theme === "dark" ? "light" : "dark")` mechanism `components/ui/theme-toggle.tsx` uses; test asserts the mocked theme flips from `light` to `dark` on click (`test_SB_014_theme_toggle_works_from_menu`). Persistence across reload is `next-themes`' own localStorage-backed behaviour (unchanged, not re-implemented here) — not independently re-tested since the mechanism itself is untouched/read-only per the clarified spec.
SB-015: PASS — clicking Sign out calls the `signOut()` server action and the menu item goes `data-disabled` while the action is pending, mirroring `SignOutButton`'s existing `useTransition` shape (`test_SB_015_sign_out_works_from_menu`).
SB-009: PASS — the mobile hamburger Sheet, once opened, renders its own account-menu trigger inside its `role="dialog"` content — same nav tree as desktop (`test_SB_009_mobile_nav_includes_account_menu`).

## Files changed
components/nav/app-sidebar.tsx
components/nav/account-menu.tsx (new)
tests/unit/f002-account-menu.test.tsx (new)
missions/20260921-212654/run-log.md (appended F002 entry)

## Commands run
`npx tsc --noEmit` (0) — 0 errors, matches baseline (0)
`npx eslint .` (1, non-zero exit but pre-existing) — 216 problems (66 errors, 150 warnings), byte-identical count to the SB-001 baseline; no new error in app-sidebar.tsx or account-menu.tsx
`npx vitest run tests/unit/f002-account-menu.test.tsx` (0) — 6/6 tests pass
`npx vitest run tests/unit` (0) — 951 passed / 100 failed / 2 skipped test files (7043 tests, 6738 passed / 299 failed / 6 skipped); failing-file list checked and contains no app-sidebar/account-menu/F002 file — the ~100 failing files are the same pre-existing network/Supabase-dependent integration-style unit tests baseline already documented (SB-001's "654 failed of 1820" across the full suite incl. `tests/integration/**`), not a regression introduced here
`git commit` (0)

## Decisions made
- Theme toggle mechanism: called `useTheme()` from `next-themes` directly inside `AccountMenu` (same hook `components/ui/theme-toggle.tsx` uses) instead of rendering that component's own `<Button>` — the spec's "Files to touch" lists `theme-toggle.tsx` as read-only reuse of its hook/logic, so the component itself is untouched; only its underlying mechanism is reused.
- `SignOutButton` (the exported function in `app-sidebar.tsx`) was kept as-is and NOT deleted — it's still exported and used by `tests/unit/optimistic-pending-audit.test.tsx` (F256, AS-497/AS-499) to test the pending-disabled pattern in isolation. SB-013 only requires no *standalone rendering* of it in the sidebar/mobile header, which is satisfied (it's no longer called from `SidebarContent`'s JSX). Deleting the export outright would have broken an existing, in-scope test file, which is out of this feature's touch list.
- `DropdownMenuItem`'s `variant="destructive"` used for Sign out, matching the existing red/destructive styling convention already present in `dropdown-menu.tsx` for irreversible actions.
- Trigger is a plain `<button>` (not the shadcn `<Button>` component) inside `DropdownMenuTrigger`'s `render` prop, matching the same pattern `workspace-switcher.tsx` uses for its own trigger.

## Out-of-scope work needed
None identified beyond this feature's own scope. SB-016 ("Other" group dissolved) and other milestone-gate assertions (SB-002..SB-008, SB-010, SB-011) are covered by F001 and the milestone validator, not re-verified here beyond confirming this feature doesn't regress them (guest filtering untouched, `resolveClientBucket` untouched, no design-token violations introduced).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept `SignOutButton` as a still-exported (but no-longer-rendered-in-sidebar) function rather than deleting it, to avoid breaking `tests/unit/optimistic-pending-audit.test.tsx` which is outside this feature's touch list — SB-013's wording ("no standalone ThemeToggle button and no standalone Sign out button" in the render tree) is satisfied without deletion.
AUTONOMOUS_DECISION: Theme persistence across reload (part of SB-014's wording) was not independently re-tested with a full reload simulation, since the persistence mechanism itself lives entirely inside `next-themes` (localStorage-backed) and is explicitly marked read-only/reused, not reimplemented, by the clarified spec — testing it would only be re-testing a third-party library already exercised elsewhere in this codebase (see `th-monaco-editor.test.tsx`'s own theme mocking for a similar precedent).

## Notes for the next worker
- Real DOM interaction tests against this app's `base-ui`-backed `DropdownMenu`/`Sheet` components can produce a transient DOM state where an element's accessible name (e.g. "Account menu") appears to match more times than expected mid-animation if you query the whole `document.body` — scope queries to `within(screen.getByRole("dialog"))` (or similar) when asserting inside an open Sheet/Popup to avoid flaky counts.
- `tests/unit/f002-account-menu.test.tsx` mocks `next-themes` and `@/lib/actions/auth` module-wide; if a future worker adds more tests to this file, reuse those existing mocks rather than adding new ones to avoid duplicate `vi.mock` calls for the same module (which vitest rejects).
- No MCP tools were used — this is a pure client-side UI feature with no live external service state to introspect (mcp-registry.md has no relevant "Worker use: yes" row for this feature).
