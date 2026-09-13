// F021 (AS-021, AS-022): the project List page previously issued a server
// `redirect(...)` to its own URL with `?viewId=<defaultViewId>` appended
// whenever a default saved view existed and no view/filter param was
// present — this replayed the proxy and both layouts for a second full
// request. This page must now resolve and apply that same default view
// directly within the same request, with no redirect call at all.
//
// Source-level check — same convention as
// list-page-single-primary-add-task-entry.test.ts uses for this same async
// Server Component page, which has no jsdom/DOM-rendering harness in this
// repo.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function readPageSource() {
  return readFileSync(
    fileURLToPath(
      new URL(
        "../../app/(workspace)/w/[workspaceSlug]/projects/[projectId]/list/page.tsx",
        import.meta.url,
      ),
    ),
    "utf8",
  );
}

describe("List page default saved view (F021, AS-021, AS-022)", () => {
  it("test_AS_021_the_page_never_calls_redirect_when_a_default_view_exists", () => {
    const source = readPageSource();

    // No `redirect(` call anywhere in the page, and the `next/navigation`
    // redirect import is gone entirely — the old redirect-to-self path
    // has been removed, not just left unreachable.
    expect(source).not.toMatch(/\bredirect\(/);
    expect(source).not.toMatch(/import\s*\{[^}]*\bredirect\b[^}]*\}\s*from\s*"next\/navigation"/);
  });

  it("test_AS_022_the_resolved_default_view_id_is_the_same_one_the_old_redirect_targeted_and_is_applied_in_request", () => {
    const source = readPageSource();

    // The same "no view/filter param at all" guard the old redirect used
    // must still gate resolving the default view — same selection logic,
    // just consumed in-request now.
    expect(source).toMatch(/getMyDefaultSavedView\(projectId,\s*"list"\)/);

    // The resolved default view's id must feed the SAME lookup
    // (`getSavedView`) the explicit `?viewId=` path already used, proving
    // it's applied as a real view for this request rather than only
    // computed and discarded.
    const effectiveViewAssignment = source.match(
      /effectiveViewId\s*=\s*defaultView\.id/,
    );
    expect(effectiveViewAssignment).not.toBeNull();

    const getSavedViewCall = source.match(/getSavedView\(effectiveViewId\)/);
    expect(getSavedViewCall).not.toBeNull();
  });
});
