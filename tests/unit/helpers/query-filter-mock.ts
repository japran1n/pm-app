// Shared by tests/unit/portal-phases-query.test.ts and
// tests/unit/portal-overview-queries.test.ts (both mock a chained
// Supabase query builder in front of an in-memory row array).
//
// F006j (missions/20260903-portal, test integrity): before this file
// existed, each of those two tests independently reimplemented the same
// three functions inline. That duplication is not just repetition — a
// mock chain whose `.eq()`/`.in()` methods discard their own arguments
// and unconditionally hand back the fixture rows cannot tell whether the
// real code's filter was ever applied. Deleting a
// `.eq("client_visible", true)` call from the code under test would
// still pass such a mock; only a missing chain METHOD would fail it.
// `applyFilters` genuinely filters the row set by every recorded
// predicate, so a test built on these three functions fails when the
// code under test's filter is dropped or points at the wrong column, not
// only when the chain's shape changes.
//
// Keep this file to exactly this: three small, table-agnostic functions
// for building an in-memory filter mock. It is not a general Supabase
// client mock — each test file still wires its own `vi.mock("@/lib/
// supabase/...")` chain shape per table, because that shape (which
// methods exist, in what order) is itself part of what the test proves
// matches the real query.

export type Row = Record<string, unknown>;
export type RowFilter = (row: Row) => boolean;

export function eqFilter(col: string, val: unknown): RowFilter {
  return (row) => row[col] === val;
}

export function inFilter(col: string, vals: readonly unknown[]): RowFilter {
  return (row) => vals.includes(row[col]);
}

// F012's `.not(col, "is", null)` / `.not(col, "in", "(a,b)")` /
// `.lt(col, val)` shapes (lib/queries/deliverables.ts's
// `getOverdueBlockingDeliverableCount`) — added alongside `eqFilter`/
// `inFilter` rather than reimplemented per test file, same reasoning
// this file's own header comment gives for those two.
export function notInFilter(col: string, csvParenList: string): RowFilter {
  const vals = csvParenList.replace(/^\(|\)$/g, "").split(",");
  return (row) => !vals.includes(String(row[col]));
}

export function notNullFilter(col: string): RowFilter {
  return (row) => row[col] !== null && row[col] !== undefined;
}

// F002 (missions/20260914-portal-simplify, AS-003): `.is(col, null)` shape
// (lib/queries/architecture.ts's `getArchitectureBoardForClient` excluding
// soft-deleted rows) -- added alongside the other filter helpers rather
// than reimplemented per test file, same reasoning this file's header
// comment gives for those.
export function isNullFilter(col: string): RowFilter {
  return (row) => row[col] === null || row[col] === undefined;
}

export function ltFilter(col: string, val: unknown): RowFilter {
  return (row) => {
    const rowVal = row[col];
    if (rowVal === null || rowVal === undefined) return false;
    return String(rowVal) < String(val);
  };
}

export function applyFilters(rows: Row[], filters: RowFilter[]): Row[] {
  return rows.filter((row) => filters.every((f) => f(row)));
}
