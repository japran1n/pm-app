2026-09-23T16:13:41Z Mission started: 21 features CLARIFIED-AUTO. Baseline in F001.
## F001 baseline
tsc:
app/(workspace)/w/[workspaceSlug]/projects/page.tsx(243,32): error TS2304: Cannot find name 'projects'.
app/(workspace)/w/[workspaceSlug]/projects/page.tsx(244,35): error TS2304: Cannot find name 'projects'.
app/(workspace)/w/[workspaceSlug]/projects/page.tsx(244,49): error TS7006: Parameter 'project' implicitly has an 'any' type.
lib/queries/projects.ts(669,11): error TS2304: Cannot find name 'UserAvatarPerson'.
tsc exit 
eslint lib/time:
vitest tests/unit:
      Tests  141 failed | 3816 passed | 3 skipped (3960)
 FAIL  tests/unit/f003-page-client-visibility-toggle.test.tsx > F003 / AS-004: page client-visibility toggle > test_AS_004_choosing_page_only_shares_just_the_page
 FAIL  tests/unit/f003-page-client-visibility-toggle.test.tsx > F003 / AS-004: page client-visibility toggle > test_AS_004_sharing_a_page_with_sections_offers_to_share_them_too
 FAIL  tests/unit/f003-page-client-visibility-toggle.test.tsx > F003 / AS-004: page client-visibility toggle > test_AS_004_team_member_can_share_a_page_with_no_sections_directly
 FAIL  tests/unit/f003-page-client-visibility-toggle.test.tsx > F003 / AS-004: page client-visibility toggle > test_AS_004_team_member_can_unmark_a_shared_page_without_a_confirmation_dialog
 FAIL  tests/unit/f003-section-client-visibility-toggle.test.tsx > F003 / AS-004: section client-visibility toggle > test_AS_004_rolls_back_optimistic_state_on_failure
 FAIL  tests/unit/f003-section-client-visibility-toggle.test.tsx > F003 / AS-004: section client-visibility toggle > test_AS_004_team_member_can_share_a_section
 FAIL  tests/unit/f003-section-client-visibility-toggle.test.tsx > F003 / AS-004: section client-visibility toggle > test_AS_004_team_member_can_unmark_a_shared_section
 FAIL  tests/unit/f006-section-card-menu-kind-row.test.tsx > F006 / AS-027, AS-028: section kind row in SectionCardMenu > test_AS_027_menu_row_section_kind_appears_in_section_card_menu
 FAIL  tests/unit/f006-section-card-menu-kind-row.test.tsx > F006 / AS-027, AS-028: section kind row in SectionCardMenu > test_AS_028_selecting_a_kind_calls_change_section_kind_and_refreshes_on_success
 FAIL  tests/unit/f006-section-card-menu-kind-row.test.tsx > F006 / AS-027, AS-028: section kind row in SectionCardMenu > test_AS_028_selecting_a_kind_shows_toast_error_on_failure_without_refresh
 FAIL  tests/unit/f007-cms-badge-section-card.test.tsx > F007 CMS badge on section card > AS-029: renders a CMS badge when section.kind is 'cms'
 FAIL  tests/unit/f007-cms-badge-section-card.test.tsx > F007 CMS badge on section card > AS-030: does not render a CMS badge when section.kind is 'static'
 FAIL  tests/unit/f007-cms-badge-section-card.test.tsx > F007 CMS badge on section card > AS-031: the existing CMS tint is still applied alongside the badge
 FAIL  tests/unit/f007-cms-badge-section-card.test.tsx > F007 CMS badge on section card > AS-032: the badge uses Supabase DS --cms-* tokens, not hardcoded colours
 FAIL  tests/unit/f008-section-card.test.tsx > F008 section card > AS-025: renders the linked component's name when present
 FAIL  tests/unit/f008-section-card.test.tsx > F008 section card > AS-025: renders the section title
 FAIL  tests/unit/f008-section-card.test.tsx > F008 section card > has a data-component attribute set to the component id when set
 FAIL  tests/unit/f008-section-card.test.tsx > F008 section card > omits data-component when there is no linked component
 FAIL  tests/unit/f009-board-layout.test.tsx > F009 architecture board horizontal layout > AS-027: many columns render side by side without a wrapping structure
migrations:
> node --env-file=.env scripts/check-migration-drift.mjs

✓ No migration drift — all migrations present on remote.
mig exit 0

## F001 implementation
- Changed lib/time/format-duration.ts output from "Xh Ym" to "X hr Y min" (TT-001).
- Updated lib/time/parse-estimate.ts regex to also accept "hr"/"min" suffixes (round-trip with new display format), keeping bare "h"/"m" support.
- Updated call-site tests that asserted the old "Xh Ym" strings: components/time/global-time-tracker.test.tsx, tests/unit/format-duration.test.ts (added TT-001 spec-example test), tests/unit/my-time-dashboard.test.tsx, tests/unit/f118-task-type-time-card.test.tsx, tests/unit/my-task-row-parity.test.tsx, tests/unit/time-tracking-estimate-render.test.ts.
- Left tests/unit/f060-discipline-estimate-schema.test.tsx untouched: its "30m"/"1h" strings come from a separate local `formatMinutes` in components/architecture/discipline-estimate-popover.tsx, not lib/time/format-duration.ts — out of scope per clarified spec (touches limited to format-duration.ts and its ~45 call sites).
- Post-change vitest tests/unit: 139 failed | 3844 passed (was 141 failed baseline) — no new failures, 2 fewer (my-time-dashboard fixes).
- tsc --noEmit: only pre-existing unrelated errors remain (app/(workspace)/w/[workspaceSlug]/projects/page.tsx, lib/queries/projects.ts, components/projects/projects-toolbar.tsx) — none touched by F001.
- eslint on touched files: clean.
- migrations:check: no drift (unaffected by this feature).
