import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { AuditTable } from "@/components/audit/audit-table";

// F252 (AS-490): the audit log page previously showed the exact same
// generic "No audit log entries match the current filters" copy whether
// the workspace genuinely had zero audit entries (no filters applied) or
// a filter combination matched nothing. This test proves the two cases
// now render distinct, purposeful copy — "nothing has happened yet" vs.
// "nothing matches your filters" — per this feature's clarified scope
// (M16 added filtering across many surfaces, so this distinction matters
// here too).
describe("AuditTable empty states (AS-490)", () => {
  const baseProps = {
    workspaceSlug: "acme",
    rows: [],
    hasMore: false,
    loadMoreHref: "/w/acme/settings/audit?limit=200",
  };

  it("test_AS_490_audit_no_entries_yet_shows_purposeful_empty_state", () => {
    const html = renderToStaticMarkup(
      createElement(AuditTable, { ...baseProps, hasActiveFilters: false }),
    );

    expect(html).toContain("No audit activity yet");
    // No "try a different filter" affordance when nothing is filtered.
    expect(html).not.toContain("No matching entries");
  });

  it("test_AS_490_audit_no_matches_for_filters_shows_filtered_empty_state", () => {
    const html = renderToStaticMarkup(
      createElement(AuditTable, { ...baseProps, hasActiveFilters: true }),
    );

    expect(html).toContain("No matching entries");
    expect(html).toContain("Try a different actor or action");
    // Distinct from the "nothing yet" copy.
    expect(html).not.toContain("No audit activity yet");
  });

  it("test_AS_490_audit_table_renders_rows_when_present_not_empty_state", () => {
    const html = renderToStaticMarkup(
      createElement(AuditTable, {
        ...baseProps,
        hasActiveFilters: false,
        rows: [
          {
            id: "11111111-1111-1111-1111-111111111111",
            action: "member_role_changed",
            actorId: "22222222-2222-2222-2222-222222222222",
            actorName: "Ada Lovelace",
            actorEmail: "ada@example.com",
            actorAvatarUrl: null,
            metadata: {},
            createdAt: "2026-08-01T00:00:00.000Z",
            targetType: "member",
            targetId: null,
          },
        ],
      }),
    );

    expect(html).not.toContain("No audit activity yet");
    expect(html).not.toContain("No matching entries");
  });
});
