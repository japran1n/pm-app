# F134 — Fix AS-006: align lint gate with CI (--max-warnings=0)

_Mission: 20260919-150607_ _Milestone: M9_

## Problem

`npm run lint` exits 0 on 7 warnings, but `.github/workflows/ci.yml` runs `npx eslint . --max-warnings=0` which exits 1 on the same 7 warnings. The AS-006 gate as measured (npm run lint) is weaker than CI.

## Fix

Fix the 7 existing warnings so `npx eslint . --max-warnings=0` exits 0:

1. `components/code-editor/editor-pane.tsx:152` — unused `eslint-disable` directive for `react-hooks/exhaustive-deps`. Remove that `// eslint-disable-next-line` comment.

2. `scripts/check-cron-health.mjs:159` — `cutoffIso` assigned but never used. Rename to `_cutoffIso` or remove the assignment.

3. `tests/unit/th-completion-providers.test.ts:323` — `registered` assigned but never used. Rename to `_registered`.

4. `tests/unit/th-editor-lazy.test.tsx:13` — `opts` argument unused. Rename to `_opts`.

5. `tests/unit/th-link-interception.test.tsx:34` — unused `eslint-disable` for `no-new-func`. Remove that directive.

6. `tests/unit/th-monaco-editor.test.tsx:157` — `configureMonacoCalledBeforeFirstMount` assigned but never used. Rename to `_configureMonacoCalledBeforeFirstMount` or remove.

7. `tests/unit/th-origin-guard.test.ts:24` — unused `eslint-disable` for `no-new-func`. Remove that directive.

After fixing all 7:

```bash
npx eslint . --max-warnings=0
```
Must exit 0 with no output.

Also run:
```bash
npx vitest run tests/unit 2>&1 | tail -5
npx tsc --noEmit
```
Both must exit 0 (fixing unused directives/variables must not break tests).

### Commit

```bash
git add <all changed files>
git commit -m "fix(F134): fix 7 eslint warnings — align npm run lint with CI [AS-006]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

Write handoff to `missions/20260919-150607/handoffs/F134-handoff.md` with Status: COMPLETE.
