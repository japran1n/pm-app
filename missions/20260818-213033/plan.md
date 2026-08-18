# Plan

_Mission: 20260818-213033 (v2)_ _Milestones: 9 (M10–M18)_ _Features: 155 (F118–F272)_ _Assertions covered: AS-201–AS-530 (330)_

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
- F125 theme-toggle — AS-211, AS-212, AS-213 [CLARIFIED-AUTO]

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

- F145 db-task-keys — AS-257, AS-259, AS-260, AS-261 [CLARIFIED-AUTO]
- F146 task-key-display — AS-258 [CLARIFIED-AUTO]
- F147 task-key-search — AS-262 [CLARIFIED-AUTO]
- F148 db-schema-subtasks — AS-265, AS-266 [CLARIFIED-AUTO]
- F149 subtask-actions — AS-267, AS-268 [CLARIFIED-AUTO]
- F150 subtask-ui — AS-263, AS-264, AS-275 [CLARIFIED-AUTO]
- F151 db-schema-checklists — AS-269, AS-274 [CLARIFIED-AUTO]
- F152 checklist-actions — AS-270, AS-271 [CLARIFIED-AUTO]
- F153 checklist-ui — AS-269, AS-271 [CLARIFIED-AUTO]
- F154 task-completion-percentage — AS-272, AS-273 [CLARIFIED-AUTO]
- F155 db-schema-task-dependencies — AS-276, AS-279, AS-284, AS-285 [CLARIFIED-AUTO]
- F156 dependency-cycle-guard — AS-278 [CLARIFIED-AUTO]
- F157 dependency-ui — AS-277, AS-282, AS-283 [CLARIFIED-AUTO]
- F158 blocked-done-warning — AS-280, AS-281 [CLARIFIED-AUTO]
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

- F194 db-schema-activity — AS-353, AS-357, AS-359 [CLARIFIED-AUTO]
- F195 activity-writer — AS-354, AS-355, AS-356, AS-360 [CLARIFIED-AUTO]
- F196 activity-feed-ui — AS-358, AS-361 [CLARIFIED-AUTO]
- F197 comment-edit-action — AS-362, AS-364 [CLARIFIED-AUTO]
- F198 comment-edited-indicator — AS-363 [CLARIFIED-AUTO]
- F199 db-schema-comment-reactions — AS-365, AS-368, AS-370 [CLARIFIED-AUTO]
- F200 reaction-actions — AS-367 [CLARIFIED-AUTO]
- F201 reaction-ui — AS-366 [CLARIFIED-AUTO]
- F202 reaction-realtime — AS-369 [CLARIFIED-AUTO]
- F203 mention-extension — AS-371, AS-372, AS-373 [CLARIFIED-AUTO]
- F204 mention-permission-filter — AS-376, AS-377 [CLARIFIED-AUTO]
- F205 mention-in-description — AS-378 [CLARIFIED-AUTO]
- F206 db-schema-notifications — AS-389, AS-392 [CLARIFIED-AUTO]
- F207 notification-fanout — AS-294, AS-374, AS-375, AS-380, AS-381, AS-382, AS-384 [CLARIFIED-AUTO]
- F208 notification-bell-panel — AS-379, AS-385, AS-386, AS-387 [CLARIFIED-AUTO]
- F209 notification-realtime — AS-388 [CLARIFIED-AUTO]
- F210 notification-deleted-target — AS-390 [CLARIFIED-AUTO]
- F211 notification-preferences — AS-391, AS-396 [CLARIFIED-AUTO]
- F212 overdue-notification-job — AS-383 [CLARIFIED-AUTO]
- F213 resend-client-setup — AS-401, AS-402 [SKIPPED — Resend not connected; deferred by user 2026-08-18]
- F214 email-templates — AS-395 [SKIPPED — Resend not connected; deferred by user 2026-08-18]
- F215 email-on-assign-mention — AS-393, AS-394 [SKIPPED — Resend not connected; deferred by user 2026-08-18]
- F216 digest-query — AS-397, AS-398 [SKIPPED — Resend not connected; deferred by user 2026-08-18]
- F217 digest-schedule — AS-399, AS-400 [SKIPPED — Resend not connected; deferred by user 2026-08-18]

## M16 — Views: custom statuses, swimlanes, saved views, my tasks, calendar, timeline

- F218 db-schema-project-statuses — AS-403, AS-407, AS-408 [CLARIFIED-AUTO]
- F219 status-management-ui — AS-404, AS-405, AS-414, AS-415 [CLARIFIED-AUTO]
- F220 status-delete-reassign — AS-406 [CLARIFIED-AUTO]
- F221 board-custom-columns — AS-409, AS-413, AS-416 [CLARIFIED-AUTO]
- F222 status-category-semantics — AS-410 [CLARIFIED-AUTO]
- F223 status-integration-list-search-dashboard — AS-411, AS-412, AS-417 [CLARIFIED-AUTO]
- F224 board-grouping-swimlanes — AS-418, AS-419, AS-421, AS-423 [CLARIFIED-AUTO]
- F225 swimlane-drag-reassign — AS-420, AS-425 [CLARIFIED-AUTO]
- F226 swimlane-collapse-persist — AS-422, AS-424 [CLARIFIED-AUTO]
- F227 db-schema-saved-views — AS-426, AS-427, AS-434 [CLARIFIED-AUTO]
- F228 saved-views-actions — AS-428, AS-430, AS-431 [CLARIFIED-AUTO]
- F229 saved-views-ui — AS-429, AS-432, AS-433 [CLARIFIED-AUTO]
- F230 my-tasks-page — AS-435, AS-436, AS-439 [CLARIFIED-AUTO]
- F231 my-tasks-scope-actions — AS-437, AS-438, AS-440, AS-441 [CLARIFIED-AUTO]
- F232 calendar-month-grid — AS-442, AS-443, AS-450 [CLARIFIED-AUTO]
- F233 calendar-task-interactions — AS-444, AS-446, AS-447 [CLARIFIED-AUTO]
- F234 calendar-drag-reschedule — AS-445 [CLARIFIED-AUTO]
- F235 calendar-filters-responsive — AS-448, AS-449 [CLARIFIED-AUTO]
- F236 db-task-start-date — AS-453 [CLARIFIED-AUTO]
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
