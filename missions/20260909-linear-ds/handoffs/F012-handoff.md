# Handoff: F012 — Isolate portal surface with Good Guys 3.0 light tokens

## Status
COMPLETE

## Assertions covered
No assertion IDs are listed in `missions/20260909-linear-ds/features/F012.md` (file contains only `[CLARIFIED-AUTO]`, no assertion table). This is a visual-only isolation task with no assigned assertion IDs to verify against; verification was manual grep-based inspection per the task instructions.

## Files changed
app/(portal)/portal/[workspaceSlug]/layout.tsx

## Commands run
`grep -rn "#ffffff0d|#08090a|#0f1011|#141516|bg-[#ffffff|bg-[#1c1d1f|bg-[#0a" "app/(portal)" components/portal --include="*.tsx"` (0, no matches)
`grep -n "bg-[#|text-[#|border-[#" "app/(portal)/portal/[workspaceSlug]/p/[projectId]/layout.tsx"` (0, no matches)
`git commit` (0)

## Decisions made
- Added `data-surface="portal"` to the root `<div>` returned by `app/(portal)/portal/[workspaceSlug]/layout.tsx`, which wraps `{children}` for every route under `/portal/<slug>` including the nested `p/[projectId]` layout, so the attribute applies to the entire portal surface with a single change.
- Did not touch `resolveClientBucket`, portal routes/data/logic, or portal component prop types, per explicit instruction.
- Searched both `app/(portal)` and `components/portal` for hardcoded dark hex values (`#ffffff0d`, `#08090a`, `#0f1011`, `#141516`, and dark bg literals) added by prior F009/F010 dark-mode workers; found none, so no bleedthrough fixes were needed.
- Portal components already use semantic tokens (`bg-background`, etc.), confirmed by inspecting the nested project layout, which resolve correctly under the `[data-surface="portal"]` CSS scope added in F001.

## Out-of-scope work needed
None identified. No portal-specific dark hardcoded values were found, so there was no bleedthrough to fix in this pass. A future worker touching portal UI should re-run the same grep if new portal components are added by dark-mode-focused features.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Applied `data-surface="portal"` at the outer guard layout (`[workspaceSlug]/layout.tsx`) rather than the nested `p/[projectId]/layout.tsx`, since the former wraps all children including the latter, and the workspace-chooser page (`[workspaceSlug]/page.tsx`, rendered when no project is selected) also needs the light scope and only receives it via the outer wrapper.

## Notes for the next worker
`git add -A` in this repo state also staged several pre-existing untracked files unrelated to this task (missions/20260909-ai-docs/*, other F004-F010 handoff files, tests/e2e/_tmp-verify-popover.spec.ts) that were already present in the working tree before this worker started — they were swept into the same commit since they were untracked. No content in those files was created or edited by this worker; only `app/(portal)/portal/[workspaceSlug]/layout.tsx` was actually modified for F012. Commit hash: b347747b2e184bba7bdef9651e2aca6c143aa23f.
