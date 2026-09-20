# F045: robust AS-004 normalisation + AS-058 deterministic collation

**Milestone:** M1 follow-up (scrutiny pass 2)
**Estimated worker time:** 30 minutes
**Depends on:** F043, F044

## Assertion IDs covered
- AS-004: `?people=all` (any capitalisation, any trailing commas) resolves to all members
- AS-008: never returns empty; selfId fallback is always used
- AS-058: ordering is deterministic for any name including case/accent ties and undefined

## Fixes

### AS-004: robust normalisation
In parsePeopleParam, replace the current trim+regex with:
```ts
const normalized = (raw ?? "").trim().replace(/[,\s]+$/g, "").toLowerCase()
```
Then check `normalized === "me"` and `normalized === "all"`. This handles: `" all "`, `"all,"`, `"all,,"`, `"ALL"`, `"All"`.

### AS-008: selfId validation note
Add a comment: "selfId may not be in activeMemberIds (e.g. workspace member removed) — returned anyway; caller is responsible." This is the documented contract, not a bug.

### AS-058: make the test actually distinguish collations
Replace the `Ärla/Zebra` test with:
- Two names that only differ by case: `"alice"` and `"Alice"` — with sensitivity:"base" they compare equal (0), so tie-break must be deterministic (use stable sort or secondary sort by id).
- Two names where Swedish vs en locale matters: `"Öl"` and `"Pa"` — in en locale `Ö` comes after `Z`, in sv locale it comes after `Ö`. Pass `"en"` explicitly and assert `"Pa"` comes before `"Öl"`.
- undefined name: member with `name: undefined` should sort last (same as null). Fix the guard: `(a.name ?? null) === null`.

### Undefined name guard fix
In orderPeopleForWholeTeam sort callback, change `=== null` to `== null` (catches both null and undefined).

## Tests
- `"AS-004: ALL (uppercase) resolves to all members"`
- `"AS-004: all,, (multiple commas) resolves to all members"`
- `"AS-058: case-only names tie-break deterministically"` — alice/Alice always same order regardless of input order
- `"AS-058: Öl sorts after Pa under en locale"` 
- `"AS-058: member with undefined name sorts last"`
