# M9 — UX validation report #1

Mission: 20260919-150607
Validator: ux-validator
Date: 2026-09-20
HEAD: 3d3e0b33 (working tree clean of code changes; only mission markdown +
untracked `.playwright-mcp` artefacts modified)
Scrutiny status at entry: GREEN (`missions/20260919-150607/milestones/M9-scrutiny-3.md`)

Features in scope: F049 (AS-168, AS-169), F050 (AS-170…AS-174),
F051 (AS-006, AS-178…AS-182).

## Scope note — why this milestone is mostly non-behavioural

M9 is a pure test/verification milestone. It ships **no new UI**. Every M9
assertion is a statement about file contents (migration headers), generated
type output (dropped columns), or source-level invariants
(`resolveClientBucket`, query column lists, removed actions). None of them is
reachable from a browser: a user cannot observe whether a `.sql` file begins
with a `--` comment, and no screen surfaces `database.types.ts`.

Per the validator brief, those are internal invariants and belong to scrutiny,
which has already passed them three times. My job here is therefore narrowed
to the two things that *are* observable at the application level:

1. **AS-006** — the gate commands, which are the milestone's own
   user-visible contract ("the suite is green").
2. **The application still boots and renders** after the M9 changes — the
   regression surface those code-level assertions exist to protect.

There is no `validation-contract.md` in this mission directory
(`find missions/20260919-150607 -name "*contract*"` returns nothing), so
assertion IDs below are taken from the feature specs in
`missions/20260919-150607/features/` and cross-checked against the scrutiny
report. **See "Process gap" at the end.**

## Assertion table

| ID | Verdict | Evidence | Reproduction |
|---|---|---|---|
| AS-006 | **PASS** | `missions/20260919-150607/milestones/evidence/M9-tsc.txt`, `M9-eslint.txt`, `M9-migrations-check.txt`, `M9-vitest-unit-full.txt` | Run each of the four in the repo root; all exit 0. See breakdown below. |
| AS-168 | PASS (code-level, not UX-observable) | `evidence/M9-vitest-m9-verbose.txt` | `npx vitest run tests/unit/m9-migration-headers.test.ts --reporter=verbose` → green. Not reachable from the UI. |
| AS-169 | PASS (code-level, not UX-observable) | `evidence/M9-vitest-m9-verbose.txt` | Same file, second `it()`. Not reachable from the UI. |
| AS-170 | **INCONCLUSIVE** | — | Deferred by the orchestrator (Docker/CI infrastructure); excluded from scrutiny's score. No test and no UI surface. |
| AS-171 | **INCONCLUSIVE** | — | Same: deferred infrastructure assertion. |
| AS-172 | PASS (code-level, not UX-observable) | `evidence/M9-vitest-m9-verbose.txt` | `npx vitest run tests/unit/m9-migration-check.test.ts` → green. Inspects `database.types.ts`; no screen renders it. |
| AS-173 | PASS (code-level, not UX-observable) | `evidence/M9-vitest-m9-verbose.txt` | Same file, second `it()`. |
| AS-174 | **INCONCLUSIVE** | — | Deferred (types-regeneration freshness is a CI concern). This is the premise AS-172/AS-173 lean on — see "Residual risk". |
| AS-178 | PASS (code-level) — **indirectly corroborated in the UI** | `evidence/M9-vitest-m9-verbose.txt`, `evidence/M9-next-build.txt` | `AS-178` hash test + `AS-178b` 16-case behaviour table, both green. The bucket mapping's user-visible effect (portal status labels) is behind auth — see "Reachability". |
| AS-179 | **INCONCLUSIVE** | `evidence/M9-tsc.txt`, `evidence/M9-next-build.txt` | `tsc --noEmit` exits 0 and `npx next build` exits 0, which is what actually satisfies this assertion. But `m9-regression.test.ts:39` advertises AS-179 in its `describe` title while containing **no `it()` block for it** — carried from scrutiny FU-15. A green M9 suite is zero evidence for AS-179, so I will not mark it PASS off that suite. The typecheck/build evidence is real but is a different mechanism than the one the test names. |
| AS-180 | PASS (code-level, not UX-observable) | `evidence/M9-vitest-m9-verbose.txt` | `npx vitest run tests/unit/m9-regression.test.ts` → the AS-180 `it()` is green. |
| AS-181 | PASS (code-level, not UX-observable) | `evidence/M9-vitest-m9-verbose.txt` | Same file; the tree-wide scan `it()` is green (189ms — it really does walk `app/ components/ lib/`). |
| AS-182 | PASS (code-level) — **traceability gap** | `evidence/M9-vitest-m9-verbose.txt` | Covered by `tests/unit/m6-action-barrel-guard.test.ts`, both `it()`s green. But `grep -rn "AS-182" tests/` returns **nothing** — the test is titled `AS-130`. The behaviour is proven; the label is not. See "Suggested fixes". |
| — (app boot) | **PASS** | `evidence/M9-app-boot.png`, `evidence/M9-app-boot-page.yml`, `evidence/M9-app-boot-console.log` | Load `http://localhost:3000/` → 200, renders the "Project management, kept simple." landing with a working Sign in control. **Zero console errors** (`grep -ic error` → 0). |

**Score: 1 PASS behavioural (AS-006) + 1 PASS app-boot; 8 PASS code-level
(scrutiny's domain, re-confirmed); 4 INCONCLUSIVE (AS-170, AS-171, AS-174
deferred; AS-179 mechanism mismatch). 0 FAIL.**

## AS-006 — gate command breakdown

All four run from `/Users/sasajapranin/Desktop/pm-app` on HEAD `3d3e0b33`:

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | **0** | No output. |
| `npx eslint . --max-warnings=0` | **0** | No output — pass 2's 7 warnings stay cleared. |
| `npm run migrations:check` | **0** | `✓ No migration drift — all migrations present on remote.` (hit the real remote Supabase, so this is a live check, not a stub.) |
| `npx vitest run tests/unit` | **0** | `504 passed | 1 skipped (505)` files, `3340 passed | 3 skipped (3343)` tests, 83.38s. |

Numbers match scrutiny pass 3 exactly, so nothing drifted between the two runs.

## M9 suite in isolation

`npx vitest run tests/unit/m9-migration-headers.test.ts
tests/unit/m9-migration-check.test.ts tests/unit/m9-regression.test.ts
tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose` → exit 0,
**4 files / 10 tests passed, 0 skipped, 0 todo**. Full verbose output in
`evidence/M9-vitest-m9-verbose.txt`. No `.skip`/`.todo` anywhere in the four
files, so the green is not hollow.

## M8 drag-and-drop at application level

- `npx next build` → **exit 0**. Full route table emitted (`evidence/M9-next-build.txt`);
  the component-panel routes under `/w/[workspaceSlug]/...` all compile.
- Dev server: one was already running on port 3000 (`next dev` refused a second
  instance on 3111 and pointed at PID 16493). I used the existing one rather than
  killing a server I did not start.
- `curl -L http://localhost:3000/` → **200**. Playwright load renders a real,
  styled landing page with zero console errors.

**Reachability limit:** the drag-reorder UI (F048) lives inside an authenticated
workspace at `/w/[workspaceSlug]/...`. I have no test account and
`ZERO_QUESTIONS` forbids me asking for one; `/login` 404s, so the sign-in flow
goes through the `Sign in` button to an external provider I cannot complete
headlessly. **I therefore could not exercise an actual drag gesture.** The
drag behaviour's assertions (AS-160…AS-164) belong to M8, not M9, and M8's
validator owns them — but if nobody has ever driven that gesture in a browser,
the mission has compile-time and unit-level proof only. Flagging for the
orchestrator, not asserting a defect.

## Residual risk

**AS-172/AS-173 rest on a deferred premise.** Both tests assert that
`database.types.ts` does *not* contain `page_components.description` /
`architecture_node_meta.client_visible`. That is only meaningful if the types
file is regenerated from the live schema — which is exactly AS-174, and AS-174
is deferred. If the file were stale, both tests would pass while the types
silently diverged from the database. Scrutiny noted the same thing and rated it
minor; AS-181's source-tree scan partially mitigates the `client_visible` half.
`npm run migrations:check` passing against the real remote raises confidence
that the schema and migrations agree, but it does not prove the *types file* is
fresh. Worth closing when AS-174 gets a home.

## Suggested fixes (not applied — I do not modify code)

1. **FU-15 (carried from scrutiny):** give AS-179 a real `it()` in
   `tests/unit/m9-regression.test.ts` or strike it from the `describe` title at
   line 39. Right now the title claims coverage the file does not have, which is
   the single reason AS-179 is INCONCLUSIVE rather than PASS here.
2. **AS-182 traceability:** `tests/unit/m6-action-barrel-guard.test.ts` proves
   AS-182 but is titled `AS-130`. Add `AS-182` to the `describe` title so
   `grep -rn "AS-182" tests/` finds its own test.
3. **FU-14 (carried):** `package.json` still has `"lint": "eslint"` while CI runs
   `eslint . --max-warnings=0`. Both are green today, so AS-006 genuinely holds —
   but the loose local script will accept the next warning CI rejects.
4. **Missing validation contract.** There is no
   `missions/20260919-150607/validation-contract.md`. Per repo rule 5 the
   contract is immutable once `APPROVED` exists — here it is simply absent, so
   validators are reconstructing assertion IDs from feature specs. This also
   means AS-numbers **collide across missions**: `grep -rn "AS-170\|AS-171\|AS-174"
   tests/` returns hits in `f042-no-approval-lock-comments.test.ts`,
   `format-duration.test.ts` and the time-totals integration tests that belong to
   an entirely different mission's numbering. A future reader grepping for an
   M9 assertion will land on unrelated tests.

## Cleanup

I did not start the dev server on 3000 (it predated this session, PID 16493) and
have left it running. My attempted server on port 3111 never bound. No code,
test, migration or config file was modified; `git status --porcelain` shows only
mission markdown and untracked `.playwright-mcp` artefacts.

Evidence directory: `missions/20260919-150607/milestones/evidence/`
