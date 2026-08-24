# Plan

_Mission: 20260818-213033 (v2)_ _Milestones: 10 (M10–M19)_ _Features: 183 (F118–F300)_ _Assertions covered: AS-201–AS-572 (372)_

Milestone and feature numbering continues from mission `20260817-230717`
(which ended at M9 / F117 / AS-176) so no ID in this repo is ever ambiguous.

Draft features — enriched by `/mission-tasks` before `/mission-run` executes any of them.
Email features F213–F217 (AS-393–AS-402) are `[SKIPPED]`: the user deferred the Resend connection. Those ten assertions stay in the contract and remain open until a follow-up mission connects Resend.

Tag legend: (no tag) draft · `[CLARIFIED]` / `[CLARIFIED-AUTO]` · `[SKIPPED]` · `[DEFERRED]` · `[COMPLETE]`

## M10 — Foundation v2 & identity primitives

Brownfield foundation: new dependencies land, new shadcn primitives land, and the
`profiles` table everything else in this mission depends on (avatars, mentions,
notifications, timezone) exists. No feature work beyond identity.

- F118 deps-install-v2 [CLARIFIED-AUTO] [COMPLETE]
- F119 shadcn-components-v2 [CLARIFIED-AUTO] [COMPLETE]
- F120 db-schema-profiles — AS-201, AS-208, AS-209, AS-210 [CLARIFIED-AUTO] [COMPLETE]
- F121 avatar-storage-bucket — AS-203, AS-205, AS-206 [CLARIFIED-AUTO] [COMPLETE]
- F122 avatar-component — AS-204, AS-214 [CLARIFIED-AUTO] [COMPLETE]
- F123 profile-settings-page — AS-202 [CLARIFIED-AUTO] [COMPLETE]
- F124 timezone-date-utils — AS-207 [CLARIFIED-AUTO] [COMPLETE]
- F125 theme-toggle — AS-211, AS-212, AS-213 [CLARIFIED-AUTO] [COMPLETE]

### M10 follow-ups (from the M10 scrutiny report — 7 FAIL)

- F273 profile-page-reachability — AS-202 [CLARIFIED-AUTO]
- F274 avatar-upload-limits-and-sniffing — AS-203, AS-205, AS-206 [CLARIFIED-AUTO]
- F275 due-date-display-timezone — AS-207 [CLARIFIED-AUTO] [COMPLETE]
- F276 profiles-rls-gaps — AS-208, AS-210 [CLARIFIED-AUTO] [COMPLETE]
- F277 dom-test-environment — AS-204, AS-214 [CLARIFIED-AUTO]
- F278 ci-runs-the-suite — (no assertion; evidence layer) [CLARIFIED-AUTO]

## M11 — Roles, permissions & project-level access

- F126 db-roles-expansion — AS-215, AS-238 [CLARIFIED-AUTO]
- F127 permissions-module — AS-230 [CLARIFIED-AUTO]
- F128 viewer-role-enforcement — AS-216, AS-217 [CLARIFIED-AUTO]
- F129 role-management-ui-update — AS-218, AS-219, AS-232, AS-235 [CLARIFIED-AUTO]
- F130 ownership-transfer-action — AS-233, AS-234 [CLARIFIED-AUTO]
- F131 db-schema-project-members — AS-224 [CLARIFIED-AUTO]
- F132 project-visibility-rls — AS-226, AS-227, AS-228, AS-229 [CLARIFIED-AUTO]
- F133 project-members-ui — AS-225, AS-236 [CLARIFIED-AUTO]
- F134 guest-role-scoping — AS-220, AS-221, AS-222, AS-223, AS-237 [CLARIFIED-AUTO]
- F135 permission-aware-ui-gating — AS-231 [CLARIFIED-AUTO]

## M12 — Workspace admin, audit log & archive

- F136 workspace-settings-page — AS-239, AS-240, AS-244 [CLARIFIED-AUTO]
- F137 workspace-slug-change-redirect — AS-241, AS-242 [CLARIFIED-AUTO]
- F138 workspace-logo-upload — AS-243 [CLARIFIED-AUTO]
- F139 db-schema-audit-log — AS-247, AS-249 [CLARIFIED-AUTO]
- F140 audit-log-writer — AS-245 [CLARIFIED-AUTO]
- F141 audit-log-page — AS-246, AS-248 [CLARIFIED-AUTO]
- F142 archive-view-page — AS-250, AS-251, AS-256 [CLARIFIED-AUTO]
- F143 restore-project-action — AS-252, AS-253, AS-255 [CLARIFIED-AUTO]
- F144 archived-scope-exclusions — AS-254 [CLARIFIED-AUTO]

## M13 — Task identity, structure & relations

- F145 db-task-keys — AS-257, AS-259, AS-260, AS-261 [CLARIFIED-AUTO] [COMPLETE]
- F146 task-key-display — AS-258 [CLARIFIED-AUTO] [COMPLETE]
- F147 task-key-search — AS-262 [CLARIFIED-AUTO] [COMPLETE]
- F148 db-schema-subtasks — AS-265, AS-266 [CLARIFIED-AUTO] [COMPLETE]
- F149 subtask-actions — AS-267, AS-268 [CLARIFIED-AUTO] [COMPLETE]
- F150 subtask-ui — AS-263, AS-264, AS-275 [CLARIFIED-AUTO] [COMPLETE]
- F151 db-schema-checklists — AS-269, AS-274 [CLARIFIED-AUTO] [COMPLETE]
- F152 checklist-actions — AS-270, AS-271 [CLARIFIED-AUTO] [COMPLETE]
- F153 checklist-ui — AS-269, AS-271 [CLARIFIED-AUTO] [COMPLETE]
- F154 task-completion-percentage — AS-272, AS-273 [CLARIFIED-AUTO] [COMPLETE]
- F155 db-schema-task-dependencies — AS-276, AS-279, AS-284, AS-285 [CLARIFIED-AUTO] [COMPLETE]
- F156 dependency-cycle-guard — AS-278 [CLARIFIED-AUTO] [COMPLETE]
- F157 dependency-ui — AS-277, AS-282, AS-283 [CLARIFIED-AUTO] [COMPLETE]
- F158 blocked-done-warning — AS-280, AS-281 [CLARIFIED-AUTO] [COMPLETE]
- F159 db-schema-task-assignees — AS-286, AS-292 [CLARIFIED-AUTO]
- F160 assignee-actions-multi — AS-289, AS-290 [CLARIFIED-AUTO]
- F161 assignee-avatar-group-ui — AS-287, AS-288 [CLARIFIED-AUTO]
- F162 assignee-filters-multi — AS-291 [CLARIFIED-AUTO]
- F163 db-schema-watchers — AS-293 [CLARIFIED-AUTO]
- F164 watcher-actions-auto — AS-295, AS-296 [CLARIFIED-AUTO]
- F165 watcher-ui — AS-297 [CLARIFIED-AUTO]
- F166 db-task-estimate-column — AS-298, AS-299, AS-305 [CLARIFIED-AUTO]
- F167 estimate-vs-actual-ui — AS-300, AS-301, AS-302 [CLARIFIED-AUTO]
- F168 project-estimate-totals — AS-303, AS-304 [CLARIFIED-AUTO]

### M13 follow-ups

- F279 board-query-perf-regression — AS-156 (mission-1 assertion, regressed) [CLARIFIED-AUTO]

## M14 — Rich text, recurrence, templates, bulk actions & trash

- F169 editor-component-tiptap — AS-306, AS-313 [CLARIFIED-AUTO]
- F170 db-task-description-json — AS-310 [CLARIFIED-AUTO]
- F171 description-render-sanitised — AS-307, AS-309 [CLARIFIED-AUTO]
- F172 editor-paste-handling — AS-308 [CLARIFIED-AUTO]
- F173 editor-task-list-checkboxes — AS-311 [CLARIFIED-AUTO]
- F174 comments-rich-text — AS-312 [CLARIFIED-AUTO]
- F175 db-schema-recurrence — AS-314, AS-323 [CLARIFIED-AUTO]
- F176 recurrence-next-occurrence-util — AS-316 [CLARIFIED-AUTO]
- F177 recurrence-on-complete — AS-315, AS-320, AS-321 [CLARIFIED-AUTO]
- F178 recurrence-scheduled-job — AS-322 [CLARIFIED-AUTO]
- F179 recurrence-ui — AS-317, AS-318, AS-319 [CLARIFIED-AUTO]
- F180 duplicate-task-action — AS-324, AS-325, AS-326, AS-327 [CLARIFIED-AUTO]
- F181 db-schema-task-templates — AS-328, AS-329 [CLARIFIED-AUTO]
- F182 template-actions — AS-330, AS-331, AS-332 [CLARIFIED-AUTO]
- F183 template-ui-page — AS-328, AS-330 [CLARIFIED-AUTO]
- F184 project-from-template — AS-333 [CLARIFIED-AUTO]
- F185 bulk-selection-ui — AS-334, AS-335, AS-336, AS-342 [CLARIFIED-AUTO]
- F186 bulk-update-action — AS-337, AS-338, AS-341 [CLARIFIED-AUTO]
- F187 bulk-delete-action — AS-339, AS-340 [CLARIFIED-AUTO]
- F188 trash-page — AS-343, AS-347, AS-352 [CLARIFIED-AUTO]
- F189 restore-task-action — AS-344, AS-351 [CLARIFIED-AUTO]
- F190 undo-toast — AS-345 [CLARIFIED-AUTO]
- F191 comment-restore — AS-346 [CLARIFIED-AUTO]
- F192 purge-action — AS-348, AS-349 [CLARIFIED-AUTO]
- F193 trash-scope-exclusions — AS-350 [CLARIFIED-AUTO]

## M15 — Collaboration: activity, comments, mentions, notifications, email

- F194 db-schema-activity — AS-353, AS-357, AS-359 [CLARIFIED-AUTO] [COMPLETE]
- F195 activity-writer — AS-354, AS-355, AS-356, AS-360 [CLARIFIED-AUTO] [COMPLETE]
- F196 activity-feed-ui — AS-358, AS-361 [CLARIFIED-AUTO] [COMPLETE]
- F197 comment-edit-action — AS-362, AS-364 [CLARIFIED-AUTO] [COMPLETE]
- F198 comment-edited-indicator — AS-363 [CLARIFIED-AUTO] [COMPLETE]
- F199 db-schema-comment-reactions — AS-365, AS-368, AS-370 [CLARIFIED-AUTO] [COMPLETE]
- F200 reaction-actions — AS-367 [CLARIFIED-AUTO] [COMPLETE]
- F201 reaction-ui — AS-366 [CLARIFIED-AUTO] [COMPLETE]
- F202 reaction-realtime — AS-369 [CLARIFIED-AUTO] [COMPLETE]
- F203 mention-extension — AS-371, AS-372, AS-373 [CLARIFIED-AUTO] [COMPLETE]
- F204 mention-permission-filter — AS-376, AS-377 [CLARIFIED-AUTO] [COMPLETE]
- F205 mention-in-description — AS-378 [CLARIFIED-AUTO] [COMPLETE]
- F206 db-schema-notifications — AS-389, AS-392 [CLARIFIED-AUTO] [COMPLETE]
- F207 notification-fanout — AS-294, AS-374, AS-375, AS-380, AS-381, AS-382, AS-384 [CLARIFIED-AUTO] [COMPLETE]
- F208 notification-bell-panel — AS-379, AS-385, AS-386, AS-387 [CLARIFIED-AUTO] [COMPLETE]
- F209 notification-realtime — AS-388 [CLARIFIED-AUTO] [COMPLETE]
- F210 notification-deleted-target — AS-390 [CLARIFIED-AUTO] [COMPLETE]
- F211 notification-preferences — AS-391, AS-396 [CLARIFIED-AUTO] [COMPLETE]
- F212 overdue-notification-job — AS-383 [CLARIFIED-AUTO] [COMPLETE]
- F213 resend-client-setup — AS-401, AS-402 [SKIPPED — Resend not connected; deferred by user 2026-08-18]
- F214 email-templates — AS-395 [SKIPPED — Resend not connected; deferred by user 2026-08-18]
- F215 email-on-assign-mention — AS-393, AS-394 [SKIPPED — Resend not connected; deferred by user 2026-08-18]
- F216 digest-query — AS-397, AS-398 [SKIPPED — Resend not connected; deferred by user 2026-08-18]
- F217 digest-schedule — AS-399, AS-400 [SKIPPED — Resend not connected; deferred by user 2026-08-18]

### M15 scrutiny follow-ups (2026-08-23, from missions/20260818-213033/milestones/M15-scrutiny.md)

- F301 fix-description-mentions-test-regression — AS-374, AS-375, AS-381, AS-384 [CLARIFIED-AUTO] [COMPLETE]
- F302 close-activity-forgery-and-comment-edit-trigger-holes — AS-357, AS-364 [CLARIFIED-AUTO] [COMPLETE]
- F303 wire-comment-metadata-and-reactions-into-task-detail — AS-363, AS-365, AS-366 [CLARIFIED-AUTO] [COMPLETE]
- F304 fix-notification-error-swallowing-and-comment-link — AS-374, AS-386 [CLARIFIED-AUTO] [COMPLETE]
- F305 fix-reactions-soft-delete-and-realtime-leak — AS-369, AS-370 [CLARIFIED-AUTO] [COMPLETE]
- F306 fan-out-activity-and-notifications-from-remaining-mutation-paths — AS-294, AS-353, AS-355, AS-380, AS-382 [CLARIFIED-AUTO] [COMPLETE]
- F307 reconcile-notification-preferences-ui-and-mark-as396-blocked — AS-391, AS-396 [CLARIFIED-AUTO] [COMPLETE]
- F308 m15-quality-cleanup-bundle — AS-361, AS-373 [CLARIFIED-AUTO] [COMPLETE]

### M15 scrutiny re-validation follow-ups (2026-08-23, from missions/20260818-213033/milestones/M15-scrutiny.md pass 2)

- F309 fix-create-notification-p-system-forgery-bypass — AS-389 [CLARIFIED-AUTO] [COMPLETE]
- F310 fix-frozen-mention-picker-and-stale-mention-chip-rendering — AS-371, AS-372, AS-373, AS-376, AS-377, AS-378 [CLARIFIED-AUTO] [COMPLETE]
- F311 wire-editcomment-mention-fanout — AS-381 [CLARIFIED-AUTO] [COMPLETE]
- F312 stabilize-integration-suite-hook-timeouts — AS-358, AS-359, AS-360, AS-374, AS-375, AS-380, AS-381, AS-382, AS-384 [CLARIFIED-AUTO] [COMPLETE]

### M15 scrutiny third-pass follow-ups (2026-08-23, from missions/20260818-213033/milestones/M15-scrutiny.md pass 3)

- F313 fix-template-copy-mention-bypass-and-getmentioncandidates-rejection — AS-376 [CLARIFIED-AUTO] [COMPLETE]
- F316 fix-create-project-from-template-mention-bypass — AS-376 [CLARIFIED-AUTO] [COMPLETE]

### M15 scrutiny fourth-pass follow-ups (2026-08-23, from missions/20260818-213033/milestones/M15-scrutiny.md pass 4)

- F317 replace-pristine-focus-mitigation-with-live-mention-candidates-ref — AS-371, AS-372, AS-373 [CLARIFIED-AUTO] [COMPLETE]

### M15 scrutiny fifth-pass follow-ups (2026-08-23, from missions/20260818-213033/milestones/M15-scrutiny.md pass 5)

- F318 fix-stale-handlekeydown-after-editor-recreation — AS-378 [CLARIFIED-AUTO] [COMPLETE]
- F319 wire-edittask-watcher-fanout-for-remaining-fields — AS-294 [CLARIFIED-AUTO] [COMPLETE]
- F320 fifth-pass-majors-cleanup-bundle — AS-376, AS-358, AS-389, AS-369 [CLARIFIED-AUTO] [COMPLETE]

### M15 scrutiny sixth-pass (final) blocker-only follow-ups (2026-08-23)

- F321 fix-overdue-sweep-orphaned-assignee-permanent-failure — AS-383 [CLARIFIED-AUTO] [COMPLETE]
- F322 enforce-private-project-access-in-single-task-actions — AS-227, AS-228 [CLARIFIED-AUTO] [COMPLETE]
- F323 enforce-private-project-access-in-sibling-action-files-and-read-paths — AS-227, AS-228, AS-229 [CLARIFIED-AUTO] [COMPLETE]
- F314 fix-mention-picker-real-coverage-rename-repaint-and-focus-loss — AS-371, AS-372, AS-373, AS-378 [CLARIFIED-AUTO] [COMPLETE]
- F315 fix-reactions-crash-and-fanout-test-gaps — AS-214, AS-369, AS-382 [CLARIFIED-AUTO] [COMPLETE]

## M16 — Views: custom statuses, swimlanes, saved views, my tasks, calendar, timeline

- F218 db-schema-project-statuses — AS-403, AS-407, AS-408 [CLARIFIED-AUTO] [COMPLETE]
- F219 status-management-ui — AS-404, AS-405, AS-414, AS-415 [CLARIFIED-AUTO] [COMPLETE]
- F220 status-delete-reassign — AS-406 [CLARIFIED-AUTO] [COMPLETE]
- F221 board-custom-columns — AS-409, AS-413, AS-416 [CLARIFIED-AUTO] [COMPLETE]
- F222 status-category-semantics — AS-410 [CLARIFIED-AUTO] [COMPLETE]
- F223 status-integration-list-search-dashboard — AS-411, AS-412, AS-417 [CLARIFIED-AUTO] [COMPLETE]
- F224 board-grouping-swimlanes — AS-418, AS-419, AS-421, AS-423 [CLARIFIED-AUTO] [COMPLETE]
- F225 swimlane-drag-reassign — AS-420, AS-425 [CLARIFIED-AUTO] [COMPLETE]
- F226 swimlane-collapse-persist — AS-422, AS-424 [CLARIFIED-AUTO] [COMPLETE]
- F227 db-schema-saved-views — AS-426, AS-427, AS-434 [CLARIFIED-AUTO] [COMPLETE]
- F228 saved-views-actions — AS-428, AS-430, AS-431 [CLARIFIED-AUTO] [COMPLETE]
- F229 saved-views-ui — AS-429, AS-432, AS-433 [CLARIFIED-AUTO] [COMPLETE]
- F230 my-tasks-page — AS-435, AS-436, AS-439 [CLARIFIED-AUTO] [COMPLETE]
- F231 my-tasks-scope-actions — AS-437, AS-438, AS-440, AS-441 [CLARIFIED-AUTO] [COMPLETE]
- F232 calendar-month-grid — AS-442, AS-443, AS-450 [CLARIFIED-AUTO] [COMPLETE]
- F233 calendar-task-interactions — AS-444, AS-446, AS-447 [CLARIFIED-AUTO] [COMPLETE]
- F234 calendar-drag-reschedule — AS-445 [CLARIFIED-AUTO] [COMPLETE]
- F235 calendar-filters-responsive — AS-448, AS-449 [CLARIFIED-AUTO] [COMPLETE]
- F236 db-task-start-date — AS-453 [CLARIFIED-AUTO] [COMPLETE]
- F237 timeline-scale-bars — AS-451, AS-452, AS-457, AS-458 [CLARIFIED-AUTO]
- F238 timeline-drag-resize — AS-454 [CLARIFIED-AUTO]
- F239 timeline-dependency-connectors — AS-455 [CLARIFIED-AUTO]
- F240 timeline-zoom — AS-456 [CLARIFIED-AUTO]

## M17 — UX polish, attachments & navigation

- F241 command-palette-shell — AS-459, AS-463, AS-464 [CLARIFIED-AUTO]
- F242 palette-search-results — AS-460, AS-461, AS-466 [CLARIFIED-AUTO]
- F243 palette-actions-recents — AS-462, AS-465 [CLARIFIED-AUTO]
- F244 shortcut-provider — AS-467, AS-468, AS-470, AS-471 [CLARIFIED-AUTO]
- F245 shortcut-help-dialog — AS-469, AS-472 [CLARIFIED-AUTO]
- F246 task-deep-link-route — AS-473, AS-474, AS-477 [CLARIFIED-AUTO]
- F247 task-modal-routing — AS-475, AS-476, AS-478 [CLARIFIED-AUTO]
- F248 quick-add-board — AS-479, AS-480, AS-482, AS-483 [CLARIFIED-AUTO]
- F249 quick-add-optimistic — AS-481 [CLARIFIED-AUTO]
- F250 list-inline-edit — AS-484, AS-485, AS-487 [CLARIFIED-AUTO]
- F251 inline-edit-permissions-realtime — AS-486, AS-488, AS-489 [CLARIFIED-AUTO]
- F252 empty-states-pass — AS-490 [CLARIFIED-AUTO]
- F253 onboarding-tour — AS-491, AS-492, AS-493 [CLARIFIED-AUTO]
- F254 sample-project-seed — AS-494 [CLARIFIED-AUTO]
- F255 skeleton-pass — AS-495, AS-496 [CLARIFIED-AUTO]
- F256 optimistic-pending-pass — AS-497, AS-498, AS-499 [CLARIFIED-AUTO]
- F257 route-error-boundaries — AS-500 [CLARIFIED-AUTO]
- F258 attachment-dropzone — AS-501, AS-502, AS-503 [CLARIFIED-AUTO]
- F259 attachment-progress — AS-504, AS-507 [CLARIFIED-AUTO]
- F260 image-thumbnails-lightbox — AS-505, AS-506 [CLARIFIED-AUTO]
- F261 clipboard-image-paste — AS-508 [CLARIFIED-AUTO]
- F262 sidebar-project-list — AS-509, AS-511, AS-512, AS-513 [CLARIFIED-AUTO]
- F263 project-favourites — AS-510 [CLARIFIED-AUTO]
- F264 mobile-board — AS-514, AS-515 [CLARIFIED-AUTO]
- F265 mobile-task-detail — AS-516, AS-518 [CLARIFIED-AUTO]
- F266 mobile-layout-audit — AS-517 [CLARIFIED-AUTO]
- F267 header-search-autocomplete — AS-519, AS-520, AS-521, AS-522 [CLARIFIED-AUTO]

## M18 — Final QA

- F268 a11y-keyboard-pass — AS-523, AS-524 [CLARIFIED-AUTO]
- F269 contrast-and-nocolor-pass — AS-525, AS-526 [CLARIFIED-AUTO]
- F270 typecheck-lint-clean — AS-527, AS-528 [CLARIFIED-AUTO]
- F271 readme-docs-v2 — AS-529 [CLARIFIED-AUTO]
- F272 e2e-suite-v2 — AS-530 [CLARIFIED-AUTO]

## M19 — QA feedback browser extension

A second deployable: a Chrome MV3 extension that turns "this looks wrong" into a real pm-app
task without leaving the page under test. Screenshot, annotate, attach technical context,
assign, send. Researched against ClickUp's extension and the specialist tools in this category
(Marker.io, BugHerd) — see tech-decisions.md § QA feedback extension.

Ordering note: this milestone depends on task keys (F145-F147, done), rich-text descriptions
(F169-F174, M14) for metadata rendering, and task deep links (F246, M17) for the "open task"
link. It can run before those land if F293 falls back to plain text and F295 falls back to the
board URL — say so in the handoff if you take a fallback.

### Foundation & auth

- F280 extension-skeleton-mv3 — AS-531 [CLARIFIED-AUTO]
- F281 extension-auth-session-handoff — AS-532, AS-533, AS-538 [CLARIFIED-AUTO]
- F282 extension-session-persistence-refresh — AS-534, AS-535, AS-536, AS-537 [CLARIFIED-AUTO]

### Capture

- F283 screenshot-capture-visible-tab — AS-539, AS-541 [CLARIFIED-AUTO]
- F284 screenshot-region-select — AS-540 [CLARIFIED-AUTO]
- F285 annotation-canvas — AS-542, AS-543, AS-545 [CLARIFIED-AUTO]
- F286 annotation-blur-tool — AS-544 [CLARIFIED-AUTO]
- F287 element-picker-selector — AS-546, AS-547 [CLARIFIED-AUTO]
- F288 environment-metadata-collector — AS-548, AS-549 [CLARIFIED-AUTO]
- F289 console-log-capture — AS-550, AS-551, AS-552 [CLARIFIED-AUTO]
- F290 network-error-capture — AS-553 [CLARIFIED-AUTO]
- F291 capture-privacy-toggles — AS-554 [CLARIFIED-AUTO]

### Task creation

- F292 api-route-create-task-from-extension — AS-558, AS-561, AS-562, AS-572 [CLARIFIED-AUTO]
- F293 extension-report-form — AS-555, AS-556, AS-557 [CLARIFIED-AUTO]
- F294 attachment-upload-from-extension — AS-559, AS-566, AS-567 [CLARIFIED-AUTO]
- F295 metadata-into-description — AS-560 [CLARIFIED-AUTO]
- F296 extension-defaults-and-success-state — AS-563, AS-564 [CLARIFIED-AUTO]

### Hardening & shipping

- F297 extension-offline-and-error-states — AS-565 [CLARIFIED-AUTO]
- F298 extension-permissions-minimisation — AS-568, AS-569 [CLARIFIED-AUTO]
- F299 extension-a11y-and-keyboard — AS-570 [CLARIFIED-AUTO]
- F300 extension-build-and-packaging — AS-571 [CLARIFIED-AUTO]
