# F105: Fix AS-069 — capacity figure sweep must cover all planner files

**Milestone:** M7 follow-up (scrutiny pass 5 FAIL)

## Problem

AS-069 asserts: no capacity/load figure (hours, percentages, utilisation stats) appears in the planner UI. The current test reads only 2 of 9 planner-related files and checks 5 narrow phrases. `32h total · 80% utilisation · capacity 40h` in a scanned file and `<div>32h / 40h (80%)</div>` elsewhere are both invisible to it.

## Fix

### Step 1 — Identify all planner files

These are the files to scan for capacity figures:
- `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`
- `components/calendar/planner-header.tsx`
- `components/calendar/stacked-planner.tsx`
- `components/calendar/stacked-person-row.tsx`
- `components/calendar/week-view.tsx`
- `components/calendar/week-time-grid.tsx`
- `components/calendar/people-switcher.tsx`
- `lib/calendar/planner-layout.ts`
- `lib/calendar/stacked-window.ts`

### Step 2 — Rewrite the AS-069 test

In the appropriate test file (find where AS-069 is currently tested), replace the narrow check with:

```ts
it("test_AS_069_no_capacity_figure_in_any_planner_file", () => {
  const plannerFiles = [
    "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
    "components/calendar/planner-header.tsx",
    "components/calendar/stacked-planner.tsx",
    "components/calendar/stacked-person-row.tsx",
    "components/calendar/week-view.tsx",
    "components/calendar/week-time-grid.tsx",
    "components/calendar/people-switcher.tsx",
  ];
  
  const capacityPatterns = [
    /\d+\s*h\s*(total|·|\/)/i,    // "32h total" or "32h · " or "32h / 40h"
    /utilis[ae]tion/i,              // "utilisation" or "utilization"
    /capacity/i,
    /\d+%\s*(load|utilis|capac)/i, // "80% load" or "80% utilisation"
    /load\s*:\s*\d/i,              // "load: 80"
    /\bh\s*·\s*\d+%/i,            // "32h · 80%"
  ];
  
  for (const file of plannerFiles) {
    const src = fs.readFileSync(path.join(process.cwd(), file), "utf-8");
    // Strip comments
    const stripped = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const pattern of capacityPatterns) {
      expect(stripped, `${file} must not contain capacity figure matching ${pattern}`).not.toMatch(pattern);
    }
  }
});
```

Mutation to verify: add `<span>32h total · 80% load</span>` to planner-header.tsx → test MUST FAIL. Restore.

### Step 3 — Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run # targeted to the test file containing AS-069
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F105-handoff.md`.
