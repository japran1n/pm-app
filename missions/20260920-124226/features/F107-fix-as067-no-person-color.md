# F107: Fix AS-067 — no per-person colour in stacked layout

**Milestone:** M7 follow-up (scrutiny pass 6 FAIL)

## Problem

AS-067 asserts blocks keep their own `block.color` and no per-person palette is applied. The current tests render StackedPersonRow directly with one person. Adding a `personColor` prop and having StackedPlanner pass `PERSON_PALETTE[i % 4]` — which overwrites block colors — passes all tests because the integration point (StackedPlanner rendering multiple rows) is never exercised.

## Fix

### Step 1 — Read the existing AS-067 test

Find it (likely in `f036-stacked-scroll-colour.test.tsx`). Understand what it currently asserts.

### Step 2 — Add StackedPlanner integration test

```ts
it("test_AS_067_block_color_not_overridden_by_person_palette", () => {
  const members = [
    { userId: "alice", name: "Alice", avatarUrl: null },
    { userId: "bob", name: "Bob", avatarUrl: null },
  ];
  const aliceBlock = { id: "b1", color: "#FF0000", userId: "alice", /* ... */ };
  const bobBlock = { id: "b2", color: "#00FF00", userId: "bob", /* ... */ };
  
  render(
    <StackedPlanner
      selectedUserIds={["alice", "bob"]}
      members={members}
      blocksByUser={new Map([["alice", [aliceBlock]], ["bob", [bobBlock]]])}
      weekKey="2026-W38"
      workspaceSlug="test"
      selfId="alice"
      weekParam="2026-W38"
    />
  );
  
  // Alice's block must have her block's own color, not PERSON_PALETTE[0]
  const aliceBlockEl = screen.getByTestId("block-b1"); // or whatever testid
  // Check the background color matches block.color, not a palette color
  expect(aliceBlockEl).not.toHaveStyle({ backgroundColor: "PERSON_PALETTE_COLOR" });
});
```

Read the actual component props and block structure first.

Mutation to verify: add `personColor={PALETTE[i]}` prop that overrides `block.color` in StackedPersonRow → this test MUST FAIL.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run (targeted test file)
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F107-handoff.md`.
