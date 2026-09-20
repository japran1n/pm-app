# M8 — UX / behavioural validation (pass 2)

Mission: `20260919-150607` · Milestone: M8 · Pass 2 (re-run after F125 / `38c27b2b`)
Validator: ux-validator (Playwright, real Chromium, real hosted Supabase)
Date: 2026-09-20

## VERDICT: GREEN — the pass-1 failure is fixed; all behavioural assertions PASS

Pass 1 was RED because `canvas-board.tsx` did not pass `projectId` to
`ComponentPanel`, so a drag in the default (canvas) view called
`reorderComponents("")` and produced an **"Invalid UUID"** toast. F125
(`38c27b2b`) added the prop and made it required (`projectId: string`, the
`= ""` default is gone). Both suggested fixes 1 and 2 from the pass-1 report
were applied. Re-run confirms the behaviour in the browser.

## Environment notes

- `missions/20260919-150607/` still contains **no `validation-contract.md` and
  no `tech-decisions.md`** (defect first flagged by M5-ux, repeated in M8-ux
  pass 1, still unaddressed). Assertion wording reconstructed from `plan.md`
  and `features/F045*.md`, `features/F048*.md`, `features/F125*.md`.
  "How to run" reconstructed as `npm run dev` (Next 16.3.5 + Turbopack,
  `.env` → hosted Supabase).
- A dev server was **already listening on :3000** and was reused (HTTP 200
  before the run). Next dev serves from disk, so the F125 commit was live.
  It was not started by me and has been left running — nothing to stop.
- Test data: a throwaway workspace / user / project / 3 components
  (`M8 Alpha`, `M8 Beta`, `M8 Gamma` at positions 100/200/300) created via the
  service key in `beforeAll`, deleted in `afterAll`. No project code modified.

Harness (kept outside the repo test suite, archived as evidence):
`missions/20260919-150607/milestones/M8-ux-2-evidence/m8-ux-2.spec.ts` + `pw.config.ts`
Run: `npx playwright test -c <M8-ux-2-evidence/pw.config.ts>` — **3 passed (26.6s)**.

## Results

| Assertion | Verdict | Evidence | Reproduction |
|---|---|---|---|
| AS-152 | PASS | `M8-ux-2-evidence/01-dialog-default-static.png`; spec L146-152 | Board → "Add page" → dialog shows a "Page kind" label and a `Change page kind` selector button. |
| AS-153 | PASS | `M8-ux-2-evidence/01-dialog-default-static.png`; spec L154-157 | Same dialog, untouched: selector reads "Static", badge carries `data-page-kind="static"`. |
| AS-154 | PASS | `02-dialog-cms-selected.png`, `03-board-after-create.png`, `03b-page-menu-cms-kind.png`; spec L159-177 | In the dialog pick "CMS", fill name `M8 CMS Page` + slug, submit. The page appears on the board; the created `tasks` row has `page_kind = "cms"`; its overflow menu shows `[data-page-kind="cms"]`. |
| AS-162 | PASS | `04-canvas-panel-initial.png`, `06-column-panel-initial.png`; spec L196-197, L243-244 | Every components row exposes live dnd-kit sortable wiring: the `Reorder <name>` grip carries an `aria-roledescription` supplied by `useSortable`, and a keyboard drag drives dnd-kit's sortable keyboard coordinate getter. Verified in **both** views. |
| AS-163 | **PASS (canvas AND column)** | canvas: `05-canvas-after-drag.png`, `05b-canvas-after-reload.png`; column: `07-column-after-drag.png`, `08-column-after-reload.png`; spec L185-227, L229-268 | See below. |
| AS-164 | **PASS (canvas AND column)** | same screenshots + `CANVAS-RSC-REFRESHES: 1` / `COLUMN-RSC-REFRESHES: 1` in the run log | See below. |
| AS-155, AS-156, AS-159, AS-160 | OUT-OF-SCOPE (internal) | — | Server-action / schema-level invariants with no UI surface — scrutiny's domain (unchanged from pass 1). |
| AS-161 | PARTIAL-OBSERVED (via AS-163) | `05-canvas-after-drag.png`, `07-column-after-drag.png` | Positions are written and re-read correctly; exact position-value semantics are a scrutiny concern. |

## AS-163 — drag reorders components, in both views

**Canvas view (the default landing view, the pass-1 failure):**
Open `/w/<ws>/projects/<id>/architecture` (no view switch), open the
Components panel, focus `Reorder M8 Alpha`, press Space → ArrowDown → Space.

- Toast area: **empty** — no "Invalid UUID", no "Something went wrong".
- On screen: `["M8 Alpha","M8 Beta","M8 Gamma"]` → `["M8 Beta","M8 Alpha","M8 Gamma"]`.
- Database: `["M8 Alpha@100","M8 Beta@200","M8 Gamma@300"]` → `["M8 Beta@0","M8 Alpha@1","M8 Gamma@2"]`.
- Survives a full page reload (`05b-canvas-after-reload.png`).
- No uncaught page errors.

**Column view:** same flow after clicking `Column view`.
`["M8 Beta","M8 Alpha","M8 Gamma"]` → `["M8 Alpha","M8 Beta","M8 Gamma"]`,
DB `["M8 Alpha@0","M8 Beta@1","M8 Gamma@2"]`, empty toast area, survives reload
(`08-column-after-reload.png`).

The pass-1 regression is gone. The canvas test in this harness is the same
assertion that failed in pass 1 (`expect(toast).not.toMatch(/Invalid UUID/)`
plus the order check), so it remains falsifiable against the old code.

## AS-164 — successful reorder calls `router.refresh()`, in both views

Two independent observations, per view:

1. **Network:** an RSC re-fetch of the current `/architecture` route
   (`RSC: 1`, not a router prefetch) fires immediately after the drop and
   after the server action resolves. Count logged as
   `CANVAS-RSC-REFRESHES: 1` and `COLUMN-RSC-REFRESHES: 1`. Before the drag
   the counter is reset to 0, so these are attributable to the reorder alone.
2. **Rendering:** `handleDragEnd` in `component-panel.tsx` keeps **no local
   order state** — it computes `arrayMove` only to build the id list it sends
   to the action. The rendered order comes exclusively from the server-supplied
   `components` prop. The on-screen order therefore *cannot* change without a
   `router.refresh()` round-trip, and it does change in both views. This makes
   the visible reorder itself a proof of the refresh.

Failure path is not exercised here (no user-reachable way to make the action
fail from the UI once `projectId` is correct) — that the failure path skips
`router.refresh()` and surfaces `toast.error` stays a scrutiny/unit concern
(F121/F124).

## Suggested fixes (not applied — validator does not modify code)

1. **Still open, mission hygiene:** `missions/20260919-150607/` has no
   `validation-contract.md` and no `tech-decisions.md`. Three separate UX
   passes have now had to reconstruct assertion wording and boot steps from
   `plan.md`. This is a real risk of validating the wrong thing.
2. **Nit, unrelated to M8 assertions:** on the canvas, the pre-seeded page
   renders its slug as `//m8-existing` (double leading slash) while the
   dialog-created page renders `/m8-cms-…`. Cosmetic slug normalisation
   inconsistency in the canvas page card — see `05-canvas-after-drag.png`.
3. **Carried over from pass 1 (item 3), still unresolved:** reorder rewrites
   positions as `0,1,2` while other code paths append at `max(position)+100`.
   Consistent within itself, but worth a scrutiny look for collisions.

## Overall: GREEN — F125 closes the pass-1 gap; AS-152, AS-153, AS-154, AS-162, AS-163, AS-164 all PASS with evidence.
