# M5 UX / behavioural validation

Mission: `20260919-150607`
Milestone: M5 (F031–F036, F094, F105 + follow-ups)
HEAD at validation: see `git rev-parse HEAD` at 2026-09-20
Validator: ux-validator (Playwright, real browser, real Supabase project)
Scrutiny input: `missions/20260919-150607/milestones/M5-scrutiny-3.md` (GREEN)

## VERDICT: GREEN

Every M5 assertion that describes observable user behaviour passes against
the running app. Five assertions are DB/internal-only and are out of UX
scope (scrutiny already covered them); they are listed as OUT-OF-SCOPE, not
as passes.

## Environment note (blocking-adjacent, read this first)

`missions/20260919-150607/` contains **no `validation-contract.md` and no
`tech-decisions.md`** — `git ls-files` on that directory returns exactly one
file, `plan.md`. Assertion wording was therefore reconstructed from
`plan.md`'s M5 table, `milestones/M5-scrutiny-3.md`, the feature handoffs,
and the in-code `AS-NNN` comments. The mapping below is my reading of those
sources, not a quote of the contract. **The orchestrator should treat the
missing contract file as a defect in mission state** (hard rule 10: state
lives in files) and re-materialise it before the next milestone gate.

"How to run" was likewise reconstructed: `npm run dev` (Next 15 + Turbopack,
`.env` against the hosted Supabase project). A dev server was already
listening on :3000 and was reused; it was **not started by me and has been
left running** (stopping a pre-existing process the user owns is out of my
remit).

## Test harness

Two specs, kept **outside** the repo tree (scratchpad) and run with a
throwaway config so no project code or test suite was modified. Both are
archived alongside the screenshots:

- `/Users/sasajapranin/Desktop/pm-app/missions/20260919-150607/milestones/M5-ux-evidence/m5-ux.spec.ts`
- `/Users/sasajapranin/Desktop/pm-app/missions/20260919-150607/milestones/M5-ux-evidence/m5-ux-b.spec.ts`
- `/Users/sasajapranin/Desktop/pm-app/missions/20260919-150607/milestones/M5-ux-evidence/pw.config.ts`

Both seed a throwaway workspace/user/project via the admin client, sign in
through a **real Supabase magic link** (same pattern as
`tests/e2e/board-reorder.spec.ts`), and tear everything down afterwards.

Result: `2 passed (25.0s)`.

The fixture deliberately writes sentinel values
(`SENTINEL-PAGE-DESCRIPTION-SHOULD-NOT-RENDER`,
`SENTINEL-SECTION-DESCRIPTION-*`) into `tasks.description_text` so that
AS-119/AS-120 are proven by *absence of something that really exists in the
row*, not by absence of data that was never there.

## Assertion table

| ID | Result | Evidence | Reproduction |
|---|---|---|---|
| AS-089 | PASS | `M5-ux-evidence/03-dialog-opened-via-Enter.png`, `04-dialog-opened-via-Space.png`, `05-after-save-icon-full.png`; spec `m5-ux.spec.ts` lines "AS-089 (a)" / "AS-089 (b)" | Architecture tab → details toggle on → focus the section copy-brief button → `Enter` opens the dialog; `Escape`; focus again → `Space` opens it. Fill Intent → Save. Dialog closes, the card's `data-node-meta-state` flips `empty`→`full` and the `aria-label` flips `Add`→`Edit` **with no reload**. A 60 ms poll over the whole save window recorded the trigger count never dropping below 1 (no unmount). `document.activeElement` after save = `BUTTON` / `aria-label="Edit copy brief for M5 Section Empty"` — focus returned to the same control, not dumped to `<body>`. |
| AS-090 | PASS | `M5-ux-evidence/02-icon-states.png`, `06-page-icon-full.png` | A section seeded with `architecture_node_meta` content renders `data-node-meta-state="full"` and a filled `FileText`; a section with no meta renders `"empty"` and an outline icon. The page-level icon starts `data-node-meta-icon-state="empty"` / `aria-label="Add copy brief for M5 Home Page"`, and after a page-level save flips to `"full"` / `"Edit copy brief for M5 Home Page"` in place. |
| AS-110 | OUT-OF-SCOPE (DB) | `handoffs/F031-handoff.md` | Row-count emptiness of a dropped column is not reachable from the UI. Covered by scrutiny (PASS). |
| AS-111 | OUT-OF-SCOPE (DB) / carried INCONCLUSIVE | `M5-scrutiny-3.md` §2 | Describes a BLOCKED control-flow branch with no artefact behind it. Nothing in the UI can exercise it. Scrutiny's FU-B stands. |
| AS-112 | PASS (UI surface) | `M5-ux-evidence/b-components-panel.png`, `b-component-edit.png` | Components panel body is exactly `"Components / Close / M5B Hero / 0 INSTANCES"` — no description anywhere. Opening the component's Rename affordance yields a single input whose only label is `Component name`; the full `input`/`textarea` placeholder+aria-label sweep of the page is `["Search tasks and projects…","Component name"]`. The only `/description/i` hit on the page is the **project** header's `"No description."`, an unrelated project field. |
| AS-113 | OUT-OF-SCOPE (internal) | `M5-scrutiny-3.md` | `COMPONENT_COLUMNS` contents are not observable from the UI beyond AS-112's surface, which passes. |
| AS-114 | OUT-OF-SCOPE (internal) | `M5-scrutiny-3.md` | Type-declaration guard. Not UI-observable. |
| AS-115 | OUT-OF-SCOPE (DB) | `M5-scrutiny-3.md` | Column existence / SQLSTATE 42703. Not UI-observable. |
| AS-116 | OUT-OF-SCOPE (DB) | `M5-scrutiny-3.md` | `pg_policy` absence. Not UI-observable. |
| AS-117 | PASS (UI surface) | `M5-ux-evidence/b-overflow-More-actions-for-M5B-Home.png`, `b-overflow-More-actions-for-M5B-Section.png` | Every overflow menu on the architecture board was opened and its items dumped. Page menu: `Page kind / STATIC / Client visibility / Delete page`. Section menu: `Link component / Create component / Section kind / STATIC / Client visibility / Delete section`. **No copy-brief / node-meta visibility control exists** — see the "Client visibility is a different feature" note below. Board control sweep (all buttons + `role=button` + `role=menuitem`) contains no node-meta visibility affordance. |
| AS-118 | OUT-OF-SCOPE (internal) | `M5-scrutiny-3.md` | `NodeMeta` type shape. Not UI-observable. |
| AS-119 | PASS | `M5-ux-evidence/01-board-details-on.png`; `m5-ux.spec.ts` sentinel assertions | Page and section tasks were seeded with real, non-empty `description_text`. Neither the rendered text nor the serialized RSC payload (`page.content()`) contains the sentinel — before saves, after two copy-brief saves, and on a fresh load in the second spec. |
| AS-120 | PASS | same as AS-119 | `description_text` is not loaded for the architecture board: it is absent from the HTML/flight payload entirely, which is stronger than "not displayed". |
| AS-121 | OUT-OF-SCOPE (internal) | `M5-scrutiny-3.md` | `estimated_by` / `updated_by` are never rendered in either the old or new UI, so their removal from the `.select()` has no observable delta. Covered by scrutiny's spy + source guard (PASS). |
| AS-122 | OUT-OF-SCOPE (DB) | `M5-scrutiny-3.md` | RLS policy expressions. Not UI-observable. |

**Zero uncaught page errors** across both specs (`PAGEERRORS=[]`).

## "Client visibility" in the overflow menus is NOT a regression

Both overflow menus still offer a **Client visibility** row. This is
`tasks.client_visible` — whether a page/section is shared to the client
portal — driven by `components/architecture/page-client-visibility-toggle.tsx`
and `lib/actions/architecture/pages.ts:765`. It is a different, still-live
concept from the dropped `architecture_node_meta.client_visible` that F033
and F034 removed (scrutiny makes the same distinction for the surviving
`BoardSection.clientVisible` references). I flag it here explicitly so a
later reader does not "fix" it.

## Notes for the orchestrator

1. **Missing mission state (major).** `validation-contract.md` and
   `tech-decisions.md` do not exist under `missions/20260919-150607/`. Every
   future validator on this mission will have to reconstruct assertions the
   same way I did, and hard rule 5 (the contract is immutable once APPROVED)
   cannot be enforced against a file that is absent. Worth a dedicated
   follow-up before M6.
2. **`getByRole("dialog")` resolves to 2 nodes** on the architecture board
   even when only one copy-brief dialog is open — both `NodeMetaDialog`
   instances (page-level and section-level) keep a dialog node in the tree.
   Harmless for sighted users, but it is an a11y smell: a screen reader may
   announce a second, empty dialog. Not covered by any M5 assertion; noted,
   not counted as a failure.
3. **Onboarding coach-mark overlays the board on a fresh account** ("Welcome
   to pm-app", 1/2) and sits on top of the page card (visible in
   `05-after-save-icon-full.png`). It did not block any interaction here
   because every action was driven by accessible name, but a real first-run
   user sees the copy-brief affordance partially occluded. Out of M5 scope.

## Suggested fixes

None required for M5 — no behavioural assertion failed. The only actionable
item is item 1 above (restore the mission's contract/tech-decisions files),
which is orchestrator state work, not project code.

## Cleanup

Seeded workspaces, users, projects, components, tasks and
`architecture_node_meta` rows were deleted in `afterAll`. No project file was
created or modified. The pre-existing dev server on :3000 was reused and left
as found.
