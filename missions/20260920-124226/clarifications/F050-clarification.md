# F050 clarification: AS-058 falsifiable sort

**Feature:** F050 — make AS-058 sort falsifiable

## Clarified implementation

### Test fixture inversion (REQUIRED)

The key requirement: fixtures where id-alphabetical order DISAGREES with name-alphabetical order.

Minimum required fixture:
```ts
// id "zz" > "aa" alphabetically, but name "Alice" < "Bob"
// Correct output: by name → ["zz", "aa"]
// id-sort would give: ["aa", "zz"]  ← must fail
const members = [{ id: "zz", name: "Alice" }, { id: "aa", name: "Bob" }]
// selfId = some third id not in this list (e.g. "self-id")
```

Apply the same inversion to the null-name case (id of null-name member sorts
before id of named member, but null-name must sort LAST):
```ts
[{ id: "aa", name: null }, { id: "zz", name: "Alice" }]
// correct: ["zz", "aa"]   (named before null)
// id-sort would give: ["aa", "zz"]  ← must fail
```

And for locale case (Öl/Pa):
```ts
[{ id: "zz", name: "Öl" }, { id: "aa", name: "Pa" }]
// correct by name: ["zz", "aa"]
// id-sort would give: ["aa", "zz"]  ← must fail
```

### Sort tie-break (REQUIRED)

Modify the comparator in `lib/calendar/people-selection.ts` to add a
tiebreaker after `localeCompare`:

```ts
rest.sort((a, b) => {
  if (a.name == null && b.name == null) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }
  if (a.name == null) return 1;
  if (b.name == null) return -1;
  const locale = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  if (locale !== 0) return locale;
  // tie-break: raw string compare on name, then id
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
});
```

### Input-order invariant tests (REQUIRED)

For case/accent tie cases, run with both input orders and assert same output:
```ts
const r1 = orderPeopleForWholeTeam([{id:"x",name:"bob"},{id:"y",name:"Bob"}], "self")
const r2 = orderPeopleForWholeTeam([{id:"y",name:"Bob"},{id:"x",name:"bob"}], "self")
expect(r1).toEqual(r2)  // order must not depend on input row order
```

## Definition of done

- Replacing the comparator body with `return a.id.localeCompare(b.id)` causes at least one test to fail
- Both input orders of `[{id:"zz",name:"Alice"},{id:"aa",name:"Bob"}]` return `["zz","aa"]`
- All planner-people-selection tests pass
- `npx tsc --noEmit` clean
- Commit made
