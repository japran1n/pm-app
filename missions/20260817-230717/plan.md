# Plan

_Mission: 20260817-230717_ _Milestones: 8_ _Features: 93_ _Assertions covered: AS-001–AS-160 (160)_

Draft features — enriched by `/mission-tasks` before `/mission-run` executes any of them.
Tag legend: (no tag) draft · `[CLARIFIED]` / `[CLARIFIED-AUTO]` · `[SKIPPED]` · `[DEFERRED]` · `[COMPLETE]`

## M1 — Foundation

Skeleton only. No business logic, no assertions assigned — this milestone proves the app boots, builds, and CI is green.

- F001 project-skeleton-nextjs
- F002 shadcn-init
- F003 supabase-project-link
- F004 ci-pipeline
- F005 base-layout-shell

## M2 — Auth & Workspace

- F006 supabase-clients
- F007 sign-in-page — AS-002
- F008 auth-callback-route — AS-003
- F009 expired-link-handling — AS-004, AS-145
- F010 proxy-auth-guard — AS-001
- F011 db-schema-workspaces
- F012 db-schema-rls-workspaces — AS-010, AS-011, AS-137, AS-138, AS-139
- F013 onboarding-create-workspace — AS-005, AS-006
- F014 workspace-switcher-ui — AS-012, AS-013, AS-042
- F015 invite-member-action — AS-007
- F016 invite-accept-on-signin — AS-008, AS-009
- F017 members-list-page — AS-023
- F018 revoke-invite-action — AS-024
- F019 change-member-role-action — AS-014, AS-015, AS-019
- F020 remove-member-action — AS-016, AS-017, AS-018
- F021 delete-workspace-action — AS-020, AS-021
- F022 signout-session-clear — AS-022
- F023 not-member-notfound-handling — AS-144

## M3 — Projects

- F024 db-schema-projects
- F025 db-schema-rls-projects — AS-028
- F026 create-project-action — AS-025, AS-026, AS-035, AS-036
- F027 project-list-page — AS-027, AS-034, AS-042
- F028 edit-project-action — AS-029, AS-037
- F029 archive-project-action — AS-030, AS-031, AS-032, AS-033
- F030 project-detail-tabs — AS-038
- F031 project-notfound-handling — AS-039, AS-040
- F032 project-empty-state — AS-041

## M4 — Tasks core

- F033 db-schema-tasks — AS-047, AS-048, AS-049, AS-050, AS-058, AS-059, AS-065, AS-066
- F034 db-schema-rls-tasks — AS-062
- F035 create-task-action — AS-043, AS-044, AS-045, AS-046
- F036 assign-task-action — AS-051, AS-052, AS-053
- F037 edit-task-action — AS-054, AS-061, AS-060
- F038 delete-task-action — AS-055, AS-056, AS-057
- F039 task-detail-sheet
- F040 overdue-indicator — AS-063, AS-064
- F041 task-tags-editor — AS-065, AS-066

## M5 — Board & drag-and-drop

- F042 board-columns-render — AS-067, AS-068
- F043 dnd-kit-setup
- F044 position-calc-util — AS-071, AS-072, AS-073, AS-074, AS-082
- F045 move-task-status-action — AS-069
- F046 reorder-task-position-action — AS-070, AS-078, AS-079, AS-080
- F047 board-optimistic-ui — AS-077
- F048 board-reload-persistence — AS-075
- F049 board-realtime-subscription — AS-076
- F050 board-soft-delete-filter — AS-081
- F051 board-column-counts — AS-083
- F052 board-permission-check — AS-084

## M6 — List, search, comments, attachments

- F053 list-view-table — AS-085
- F054 list-view-filters — AS-086, AS-087, AS-088, AS-089, AS-090
- F055 list-view-sort — AS-091
- F056 list-view-empty-state — AS-092
- F057 list-status-inline-edit — AS-093
- F058 db-schema-comments — AS-104
- F059 add-comment-action — AS-094, AS-095
- F060 comment-list-render — AS-096, AS-097
- F061 delete-comment-action — AS-098, AS-099, AS-100
- F062 comment-soft-delete-realtime — AS-101, AS-102
- F063 comment-realtime-subscription — AS-103
- F064 db-schema-attachments — AS-106, AS-107
- F065 upload-attachment-action — AS-105, AS-108, AS-112, AS-113
- F066 attachment-list-render — AS-109, AS-115
- F067 delete-attachment-action — AS-110, AS-111, AS-114
- F068 db-fts-setup — AS-117, AS-123, AS-124
- F069 search-page-ui — AS-116, AS-119, AS-120
- F070 search-action — AS-118, AS-121, AS-122

## M7 — Dashboard

- F071 db-rpc-priority-counts — AS-125, AS-127, AS-128, AS-129
- F072 db-rpc-status-counts — AS-126, AS-127, AS-128, AS-129
- F073 dashboard-charts-render — AS-135
- F074 dashboard-empty-state — AS-130
- F075 dashboard-overdue-count — AS-131
- F076 dashboard-workspace-switch-refresh — AS-132
- F077 dashboard-rls-verification — AS-133
- F078 dashboard-table-filters — AS-134

## M8 — Security, quality, accessibility, docs, polish

- F079 rls-audit-all-tables — AS-137, AS-138, AS-139
- F080 env-secrets-audit — AS-140, AS-141, AS-142
- F081 server-action-membership-reguard — AS-143
- F082 zod-schemas-all-actions — AS-146, AS-160
- F083 sanitization-audit — AS-148
- F084 parameterized-queries-audit — AS-147
- F085 keyboard-a11y-pass — AS-151
- F086 aria-labels-pass — AS-152
- F087 color-contrast-status-labels — AS-153, AS-154
- F088 ssr-audit — AS-155
- F089 perf-budget-check — AS-156, AS-136
- F090 e2e-board-reorder-test — AS-150
- F091 unit-test-suite — AS-149
- F092 readme-docs — AS-159
- F093 typecheck-lint-clean — AS-157, AS-158

## Coverage check

160/160 assertions (AS-001–AS-160) each appear in at least one feature above.
