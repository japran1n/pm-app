// F016/F059/F060 (AS-034): "The calendar page issues no task query."
//
// Source-text guard: reads the calendar page + WeekView subtree source
// files directly, extracts every `@/lib/queries/*` import path, and
// asserts each one appears in an explicit allowlist of query modules
// these files legitimately need. Any new import from a task-querying
// module (e.g. "@/lib/queries/tasks", "@/lib/queries/my-tasks") that is
// not in the allowlist fails the test, regardless of how the import is
// spelled (default/named/type-only) or where in the file it appears.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..", "..");

const FILES = [
  "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
  "components/calendar/week-view.tsx",
  "components/calendar/week-time-grid.tsx",
  "components/calendar/week-agenda.tsx",
];

// Every @/lib/queries/* module these files are allowed to import from.
// Task-querying modules ("@/lib/queries/tasks", "@/lib/queries/my-tasks",
// "@/lib/queries/calendar" which historically re-exported task queries,
// etc.) must never be added here.
const ALLOWED_QUERY_MODULES = new Set([
  "@/lib/queries/profile",
  "@/lib/queries/calendar-blocks",
  "@/lib/queries/time-off",
  "@/lib/queries/members",
]);

function readSource(relPath: string): string {
  return readFileSync(path.join(ROOT, relPath), "utf8");
}

// Matches `from "@/lib/queries/xyz"` / `from '@/lib/queries/xyz'` in any
// import statement (static, type-only, or re-export).
const QUERY_IMPORT_RE = /from\s+["'](@\/lib\/queries\/[^"']+)["']/g;

function extractQueryImports(source: string): string[] {
  const found: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = QUERY_IMPORT_RE.exec(source)) !== null) {
    found.push(match[1]!);
  }
  return found;
}

describe("F016/F059/F060 calendar page issues no task query (AS-034)", () => {
  for (const file of FILES) {
    it(`test_AS_034_${file.replace(/[^a-zA-Z0-9]+/g, "_")}_only_imports_allowlisted_query_modules`, () => {
      const source = readSource(file);
      const imports = extractQueryImports(source);

      for (const importPath of imports) {
        expect(
          ALLOWED_QUERY_MODULES.has(importPath),
          `${file} imports "${importPath}" from @/lib/queries, which is not in the allowlist. ` +
            `If this is a legitimate new dependency, add it explicitly; if it is a task query ` +
            `("@/lib/queries/tasks", "@/lib/queries/my-tasks", etc.) it must not be imported here.`,
        ).toBe(true);
      }
    });
  }

  it("test_AS_034_calendar_subtree_never_imports_task_query_modules", () => {
    const forbiddenModules = [
      "@/lib/queries/tasks",
      "@/lib/queries/my-tasks",
      "@/lib/queries/calendar",
    ];

    for (const file of FILES) {
      const source = readSource(file);
      const imports = extractQueryImports(source);
      for (const forbidden of forbiddenModules) {
        expect(imports).not.toContain(forbidden);
      }
    }
  });

  it("test_AS_034_calendar_subtree_never_calls_getCalendarTasks", () => {
    for (const file of FILES) {
      const source = readSource(file);
      expect(source).not.toContain("getCalendarTasks");
    }
  });

  it("test_AS_034_calendar_page_searchParams_type_has_no_task_shaped_fields", () => {
    const source = readSource(
      "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
    );

    const searchParamsMatch = source.match(
      /searchParams:\s*Promise<\{([\s\S]*?)\}>/,
    );
    expect(searchParamsMatch).not.toBeNull();
    const searchParamsType = searchParamsMatch![1]!;

    for (const field of [
      "status:",
      "priority:",
      "assigneeId:",
      "projectId:",
      "taskId:",
    ]) {
      expect(searchParamsType).not.toContain(field);
    }
  });
});
