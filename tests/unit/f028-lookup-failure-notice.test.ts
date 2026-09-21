import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(
  "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/brief/page.tsx",
  "utf8",
).replace(/\s+/g, " ");

const notice = () => {
  const m = src.match(/<p className="([^"]*)" role="alert">(.*?)<\/p>/);
  expect(m).not.toBeNull();
  return { cls: m![1], text: m![2] };
};

describe("F028 docs-lookup failure notice", () => {
  it("test_BR_006_notice_lists_all_unavailable_actions", () => {
    const { text } = notice();
    for (const a of ["Generate Document", "Request Approval", "Approve", "Withdraw approval"]) {
      expect(text).toContain(a);
    }
  });

  it("test_BR_007_notice_body_uses_readable_token_not_warning", () => {
    const { cls } = notice();
    expect(cls).not.toContain("text-warning");
    expect(cls).toMatch(/text-(foreground|muted-foreground)/);
  });

  it("test_BR_026_notice_keeps_alert_role", () => {
    expect(src).toContain('role="alert"');
  });
});
