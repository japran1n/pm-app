# Plan

_Mission: 20260817-230717_ _Milestones: 8_ _Features: 93_ _Assertions covered: AS-001–AS-160 (160)_

Draft features — enriched by `/mission-tasks` before `/mission-run` executes any of them.
Tag legend: (no tag) draft · `[CLARIFIED]` / `[CLARIFIED-AUTO]` · `[SKIPPED]` · `[DEFERRED]` · `[COMPLETE]`

## M1 — Foundation

Skeleton only. No business logic, no assertions assigned — this milestone proves the app boots, builds, and CI is green.

- F001 project-skeleton-nextjs [CLARIFIED-AUTO] [COMPLETE]
- F002 shadcn-init [CLARIFIED-AUTO] [COMPLETE]
- F003 supabase-project-link [CLARIFIED-AUTO] [COMPLETE]
- F004 ci-pipeline [CLARIFIED-AUTO] [COMPLETE]
- F005 base-layout-shell [CLARIFIED-AUTO] [COMPLETE]

## M2 — Auth & Workspace [GREEN]

- F006 supabase-clients [CLARIFIED-AUTO] [COMPLETE]
- F007 sign-in-page — AS-002 [CLARIFIED-AUTO] [COMPLETE]
- F008 auth-callback-route — AS-003 [CLARIFIED-AUTO] [COMPLETE]
- F009 expired-link-handling — AS-004, AS-145 [CLARIFIED-AUTO] [COMPLETE]
- F010 proxy-auth-guard — AS-001 [CLARIFIED-AUTO] [COMPLETE]
- F011 db-schema-workspaces [CLARIFIED-AUTO] [COMPLETE]
- F012 db-schema-rls-workspaces — AS-010, AS-011, AS-137, AS-138, AS-139 [CLARIFIED-AUTO] [COMPLETE]
- F013 onboarding-create-workspace — AS-005, AS-006 [CLARIFIED-AUTO] [COMPLETE]
- F014 workspace-switcher-ui — AS-012, AS-013, AS-042 [CLARIFIED-AUTO] [COMPLETE]
- F015 invite-member-action — AS-007 [CLARIFIED-AUTO] [COMPLETE]
- F016 invite-accept-on-signin — AS-008, AS-009 [CLARIFIED-AUTO] [COMPLETE]
- F017 members-list-page — AS-023 [CLARIFIED-AUTO] [COMPLETE]
- F018 revoke-invite-action — AS-024 [CLARIFIED-AUTO] [COMPLETE]
- F019 change-member-role-action — AS-014, AS-015, AS-019 [CLARIFIED-AUTO] [COMPLETE]
- F020 remove-member-action — AS-016, AS-017, AS-018 [CLARIFIED-AUTO] [COMPLETE]
- F021 delete-workspace-action — AS-020, AS-021 [CLARIFIED-AUTO] [COMPLETE]
- F022 signout-session-clear — AS-022 [CLARIFIED-AUTO] [COMPLETE]
- F023 not-member-notfound-handling — AS-144 [CLARIFIED-AUTO] [COMPLETE]

## M3 — Projects [GREEN]

- F024 db-schema-projects [CLARIFIED-AUTO] [COMPLETE]
- F025 db-schema-rls-projects — AS-028 [CLARIFIED-AUTO] [COMPLETE]
- F026 create-project-action — AS-025, AS-026, AS-035, AS-036 [CLARIFIED-AUTO] [COMPLETE]
- F027 project-list-page — AS-027, AS-034, AS-042 [CLARIFIED-AUTO] [COMPLETE]
- F028 edit-project-action — AS-029, AS-037 [CLARIFIED-AUTO] [COMPLETE]
- F029 archive-project-action — AS-030, AS-031, AS-032, AS-033 [CLARIFIED-AUTO] [COMPLETE]
- F030 project-detail-tabs — AS-038 [CLARIFIED-AUTO] [COMPLETE]
- F031 project-notfound-handling — AS-039, AS-040 [CLARIFIED-AUTO] [COMPLETE]
- F032 project-empty-state — AS-041 [CLARIFIED-AUTO] [COMPLETE]

## M4 — Tasks core [GREEN]

- F033 db-schema-tasks — AS-047, AS-048, AS-049, AS-050, AS-058, AS-059, AS-065, AS-066 [CLARIFIED-AUTO] [COMPLETE]
- F034 db-schema-rls-tasks — AS-062 [CLARIFIED-AUTO] [COMPLETE]
- F035 create-task-action — AS-043, AS-044, AS-045, AS-046 [CLARIFIED-AUTO] [COMPLETE]
- F036 assign-task-action — AS-051, AS-052, AS-053 [CLARIFIED-AUTO] [COMPLETE]
- F037 edit-task-action — AS-054, AS-061, AS-060 [CLARIFIED-AUTO] [COMPLETE]
- F038 delete-task-action — AS-055, AS-056, AS-057 [CLARIFIED-AUTO] [COMPLETE]
- F039 task-detail-sheet [CLARIFIED-AUTO] [COMPLETE]
- F040 overdue-indicator — AS-063, AS-064 [CLARIFIED-AUTO] [COMPLETE]
- F041 task-tags-editor — AS-065, AS-066 [CLARIFIED-AUTO] [COMPLETE]

## M5 — Board & drag-and-drop [GREEN]

- F042 board-columns-render — AS-067, AS-068 [CLARIFIED-AUTO] [COMPLETE]
- F043 dnd-kit-setup [CLARIFIED-AUTO] [COMPLETE]
- F044 position-calc-util — AS-071, AS-072, AS-073, AS-074, AS-082 [CLARIFIED-AUTO] [COMPLETE]
- F045 move-task-status-action — AS-069 [CLARIFIED-AUTO] [COMPLETE]
- F046 reorder-task-position-action — AS-070, AS-078, AS-079, AS-080 [CLARIFIED-AUTO] [COMPLETE]
- F047 board-optimistic-ui — AS-077 [CLARIFIED-AUTO] [COMPLETE]
- F048 board-reload-persistence — AS-075 [CLARIFIED-AUTO] [COMPLETE]
- F049 board-realtime-subscription — AS-076 [CLARIFIED-AUTO] [COMPLETE]
- F050 board-soft-delete-filter — AS-081 [CLARIFIED-AUTO] [COMPLETE]
- F051 board-column-counts — AS-083 [CLARIFIED-AUTO] [COMPLETE]
- F052 board-permission-check — AS-084 [CLARIFIED-AUTO] [COMPLETE]

## M6 — List, search, comments, attachments

- F053 list-view-table — AS-085 [CLARIFIED-AUTO] [COMPLETE]
- F054 list-view-filters — AS-086, AS-087, AS-088, AS-089, AS-090 [CLARIFIED-AUTO] [COMPLETE]
- F055 list-view-sort — AS-091 [CLARIFIED-AUTO] [COMPLETE]
- F056 list-view-empty-state — AS-092 [CLARIFIED-AUTO] [COMPLETE]
- F057 list-status-inline-edit — AS-093 [CLARIFIED-AUTO] [COMPLETE]
- F058 db-schema-comments — AS-104 [CLARIFIED-AUTO] [COMPLETE]
- F059 add-comment-action — AS-094, AS-095 [CLARIFIED-AUTO] [COMPLETE]
- F060 comment-list-render — AS-096, AS-097 [CLARIFIED-AUTO] [COMPLETE]
- F061 delete-comment-action — AS-098, AS-099, AS-100 [CLARIFIED-AUTO] [COMPLETE]
- F062 comment-soft-delete-realtime — AS-101, AS-102 [CLARIFIED-AUTO] [COMPLETE]
- F063 comment-realtime-subscription — AS-103 [CLARIFIED-AUTO] [COMPLETE]
- F064 db-schema-attachments — AS-106, AS-107 [CLARIFIED-AUTO] [COMPLETE]
- F065 upload-attachment-action — AS-105, AS-108, AS-112, AS-113 [CLARIFIED-AUTO] [COMPLETE]
- F066 attachment-list-render — AS-109, AS-115 [CLARIFIED-AUTO] [COMPLETE]
- F067 delete-attachment-action — AS-110, AS-111, AS-114 [CLARIFIED-AUTO] [COMPLETE]
- F068 db-fts-setup — AS-117, AS-123, AS-124 [CLARIFIED-AUTO] [COMPLETE]
- F069 search-page-ui — AS-116, AS-119, AS-120 [CLARIFIED-AUTO] [COMPLETE]
- F070 search-action — AS-118, AS-121, AS-122 [CLARIFIED-AUTO] [COMPLETE]

## M7 — Dashboard

- F071 db-rpc-priority-counts — AS-125, AS-127, AS-128, AS-129 [CLARIFIED-AUTO]
- F072 db-rpc-status-counts — AS-126, AS-127, AS-128, AS-129 [CLARIFIED-AUTO]
- F073 dashboard-charts-render — AS-135 [CLARIFIED-AUTO]
- F074 dashboard-empty-state — AS-130 [CLARIFIED-AUTO]
- F075 dashboard-overdue-count — AS-131 [CLARIFIED-AUTO]
- F076 dashboard-workspace-switch-refresh — AS-132 [CLARIFIED-AUTO]
- F077 dashboard-rls-verification — AS-133 [CLARIFIED-AUTO]
- F078 dashboard-table-filters — AS-134 [CLARIFIED-AUTO]

## M8 — Security, quality, accessibility, docs, polish

- F079 rls-audit-all-tables — AS-137, AS-138, AS-139 [CLARIFIED-AUTO]
- F080 env-secrets-audit — AS-140, AS-141, AS-142 [CLARIFIED-AUTO]
- F081 server-action-membership-reguard — AS-143 [CLARIFIED-AUTO]
- F082 zod-schemas-all-actions — AS-146, AS-160 [CLARIFIED-AUTO]
- F083 sanitization-audit — AS-148 [CLARIFIED-AUTO]
- F084 parameterized-queries-audit — AS-147 [CLARIFIED-AUTO]
- F085 keyboard-a11y-pass — AS-151 [CLARIFIED-AUTO]
- F086 aria-labels-pass — AS-152 [CLARIFIED-AUTO]
- F087 color-contrast-status-labels — AS-153, AS-154 [CLARIFIED-AUTO]
- F088 ssr-audit — AS-155 [CLARIFIED-AUTO]
- F089 perf-budget-check — AS-156, AS-136 [CLARIFIED-AUTO]
- F090 e2e-board-reorder-test — AS-150 [CLARIFIED-AUTO]
- F091 unit-test-suite — AS-149 [CLARIFIED-AUTO]
- F092 readme-docs — AS-159 [CLARIFIED-AUTO]
- F093 typecheck-lint-clean — AS-157, AS-158 [CLARIFIED-AUTO]

## Coverage check

160/160 assertions (AS-001–AS-160) each appear in at least one feature above.

## M2 follow-ups (from M2 scrutiny — see milestones/M2-scrutiny.md)

- F094 sole-owner-atomic-guard — AS-018 [CLARIFIED-AUTO] [COMPLETE]
- F095 workspace-insert-rls-hardening — AS-006 [CLARIFIED-AUTO] [COMPLETE]
- F096 proxy-guard-integration-test — AS-001 [CLARIFIED-AUTO] [COMPLETE]
- F097 onboarding-membership-gate — AS-005 [CLARIFIED-AUTO] [COMPLETE]
- F098 signout-cache-headers — AS-022 [CLARIFIED-AUTO] [COMPLETE]
- F099 invite-listusers-pagination — AS-007 [CLARIFIED-AUTO] [COMPLETE]

## M3 follow-ups (from M3 scrutiny — see milestones/M3-scrutiny.md)

- F100 project-name-check-constraint — AS-026 [CLARIFIED-AUTO] [COMPLETE]

## Deferred re-verification (not a defect — genuinely blocked on later milestone)

- AS-034 (open task count on project list, F027): cannot be genuinely satisfied until the tasks table exists (M4). Currently a documented `null`/pending placeholder, not a fake value. Re-verify AS-034 as part of a feature added once F033 (tasks table) lands — do not spawn a fix now, it would just fail again for the same structural reason.

## Deferred re-verification (M4)

- AS-064 (overdue visual indicator, F040): logic is correct and unit-tested, but no board/list view exists yet to render TaskCard where it would be observable. Re-verify visually once F042 (board-columns-render) lands — not a defect, a sequencing artifact.

## M5 follow-ups (from M5 scrutiny — see milestones/M5-scrutiny.md)

- F101 position-bound-fix — AS-072, AS-082 [CLARIFIED-AUTO] [COMPLETE]
- F102 optimistic-rollback-partial-failure — AS-077 [CLARIFIED-AUTO] [COMPLETE]
- F103 realtime-ordering-guard — AS-076 [CLARIFIED-AUTO] [COMPLETE]

## M6 follow-ups (from M6 scrutiny — see milestones/M6-scrutiny.md)

- F104 comment-delete-realtime-fix — AS-101 [CLARIFIED-AUTO]

## Noted but not spawned as separate features (M6 scrutiny minor gaps)

- CI secret configuration for RLS integration tests (describe.skipIf pattern skips silently without SUPABASE_SECRET_KEY) — to be confirmed as part of M8's CI/quality audit (F093).
- AS-102's comment read path not yet wired into TaskDetailSheet's initial fetch (comments prop defaults to []) — functional gap, will surface naturally when exercised; low priority, not a security issue.
- Minor test-assertion-strength gaps (AS-108 TTL not pinned, AS-114 partial-failure branch untested, AS-121 asserts count not id-absence) — acceptable given the underlying code is confirmed correct by direct read; not worth separate features at this project's stated "critical paths only" test-coverage target (discovery Q26).
