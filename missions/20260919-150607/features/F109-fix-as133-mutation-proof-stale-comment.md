# F109 — Fix AS-133: mutation proof must demonstrate stale-comment scenario

_Mission: 20260919-150607_ _Milestone: M6 follow-up (scrutiny-1)_

## Problem

F040's mutation proof for AS-133 showed the guard catches an action with 
zero textual mentions — but the handoff admits that removing just the import 
(leaving a comment mention) did NOT fail the guard. The realistic dead-action 
scenario is: developer removes the call site but leaves a comment behind. 
This is what AS-133 must prove the guard catches.

NOTE: This feature depends on F107 (the barrel guard rewrite). F107 fixes the 
guard to strip comments before scanning. Once F107 is merged, the stale-comment 
scenario will correctly fail.

## Fix

After F107 is merged:
1. Run the mutation: remove import+call of `changeSectionKind` from 
   `components/architecture/section-card-menu.tsx`, but intentionally leave 
   a comment mentioning `changeSectionKind` in the same file or nearby
2. Run `npx vitest run tests/unit/m6-action-barrel-guard.test.ts --reporter=verbose 2>&1`
3. Confirm the test FAILS (guard sees through the comment)
4. Revert: `git checkout -- <file>`
5. Confirm revert: `git diff` empty

Write updated handoff with this proof. This REPLACES (overwrites) 
`missions/20260919-150607/handoffs/F040-handoff.md` to correct the AS-133 proof.

No code changes — just rerun the mutation and update the handoff.

## Assertion covered

- **AS-133**: mutation proof demonstrates guard catches realistic stale-comment scenario

## Definition of done

- Updated F040 handoff shows FAIL output when import+call removed but comment remains
- `git diff` = empty after revert
- Depends on F107 being COMPLETE first
