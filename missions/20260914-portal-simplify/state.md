# State — 20260914-portal-simplify

Phase: COMPLETE (2026-09-14). Branch `feat/portal-simplify`, not merged, no PR.

| Feature | Status |
|---|---|
| F001–F004 (+F004b–d) | DONE — M1 scrutiny PASS |
| F005–F011 | DONE |
| F012 | DONE — live DB: dropped `cascade_delete_task(uuid)` overload (applied via MCP) + migration file |
| F013–F017 | DONE — M2 scrutiny remediation, re-review PASS |
| F018 | DONE — UX validation fixes |

Final gate (orchestrator, after F018): tsc OK · next build OK · vitest 3023 pass / 5 fail — all 5 in 4 files confirmed failing on base cb220b08 (app-sidebar-project-nav-list, f017-suspense-fallback-footprint, f038-as024-coverage, xss-sanitization-audit).

Not verified in browser: team-side (AS-012 team inbox, AS-020) — covered by unit tests only. F018 fixes not re-checked in browser.

Known minors (open): stale approvalId link gives no "closed" hint; attachments error persists after removal; getDeliverablesPastDueCount still counts delivered as overdue (unused by portal); no test pins copy-link URL; realtime "falling back to REST" warning on Messages.
