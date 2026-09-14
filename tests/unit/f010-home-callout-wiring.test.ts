// Mission 20260914-portal-simplify, F010 (AS-018): the Home page wires the
// callout to F005's `getWaitingOnYouCount`, and hides it whenever that read
// fails (never a fabricated zero). The Overview page is a Server Component
// (cannot be rendered outside a live Next.js request context -- see
// tests/integration/f025-portal-route-walk.test.ts's own header for why
// this codebase's convention for such pages is a static source check
// rather than a render test), so this asserts the wiring directly on the
// page's own source: the callout is only rendered from the `.ok` branch of
// `getWaitingOnYouCount`'s result, and reads the same `total`/`overdue`
// fields that helper returns.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PAGE_PATH = join(
  process.cwd(),
  "app/(portal)/portal/[workspaceSlug]/p/[projectId]/page.tsx",
);

describe("F010 / AS-018: Home callout wiring", () => {
  const source = readFileSync(PAGE_PATH, "utf8");

  it("test_AS_018_page_reads_the_shared_getWaitingOnYouCount_helper", () => {
    expect(source).toContain("getWaitingOnYouCount(project.id, today)");
  });

  it("test_AS_018_the_callout_is_only_rendered_when_the_read_succeeded", () => {
    // `waitingOnYouCount` is only non-null when `waitingOnYouCountResult.ok`
    // is true -- a failed read never reaches the callout.
    expect(source).toMatch(
      /const waitingOnYouCount = waitingOnYouCountResult\.ok \? waitingOnYouCountResult\.data : null;/,
    );
    expect(source).toMatch(/\{waitingOnYouCount && \(\s*<WaitingOnYouCallout/);
  });

  it("test_AS_018_the_callout_receives_the_same_total_and_overdue_fields_the_helper_returns", () => {
    expect(source).toMatch(/total=\{waitingOnYouCount\.total\}/);
    expect(source).toMatch(/overdue=\{waitingOnYouCount\.overdue\}/);
  });

  it("test_AS_018_the_callout_links_to_the_For_you_route_for_this_project", () => {
    expect(source).toMatch(
      /href=\{`\/portal\/\$\{workspace\.slug\}\/p\/\$\{project\.id\}\/for-you`\}/,
    );
  });

  it("test_AS_018_the_old_duplicating_waiting_on_you_list_block_is_gone_from_this_page", () => {
    expect(source).not.toContain("WaitingOnYouBlock");
    expect(source).not.toContain("buildWaitingOnYouItems");
  });
});
