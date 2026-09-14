// Mission 20260914-portal-simplify, F010 (AS-019): "No client-facing
// control says 'Request changes'; it says 'Ask for changes'." F013 widened
// this sweep from just `components/portal` and `app/(portal)` to the
// whole `app`, `components`, `lib` tree -- the M2 scrutiny finding was
// that scoping to portal-only directories lets an offender slip through
// if it ever lands in a shared component. Excluded by rule: the
// workspace-side `app/(workspace)` (`/w/...`) tree, which is a
// genuinely different, team-facing app section (e.g.
// `components/approvals/request-approval-dialog.tsx`, which legitimately
// keeps saying "Request changes" for the team per this mission's own
// instruction that team-side wording is unchanged).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_DIRS = [join(ROOT, "app"), join(ROOT, "components"), join(ROOT, "lib")];
const EXCLUDED_DIR_SEGMENTS = new Set(["node_modules", ".next", "(workspace)"]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED_DIR_SEGMENTS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.isFile() && /\.(tsx?|jsx?)$/.test(entry.name) && !entry.name.includes(".test.")) {
      out.push(full);
    }
  }
  return out;
}

describe("F010 / AS-019: no client-facing 'Request changes' string remains", () => {
  const files = SOURCE_DIRS.flatMap(walk);

  it("test_AS_019_scans_at_least_the_known_approval_components", () => {
    expect(files.some((f) => f.endsWith("approval-card.tsx"))).toBe(true);
    expect(files.some((f) => f.endsWith("approval-actions.tsx"))).toBe(true);
  });

  it("test_AS_019_no_portal_source_file_renders_the_string_Request_changes", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Only the rendered/user-visible occurrence matters -- a plain
      // case-sensitive substring match on the JSX button label wording,
      // not the lower-case "request changes" that shows up inside code
      // comments/identifiers describing the underlying server action.
      if (/>\s*Request changes\s*</.test(source) || /"Request changes"/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("test_AS_019_approval_card_and_approval_actions_say_Ask_for_changes", () => {
    const approvalCard = readFileSync(join(ROOT, "components/portal/approval-card.tsx"), "utf8");
    const approvalActions = readFileSync(
      join(ROOT, "components/portal/approval-actions.tsx"),
      "utf8",
    );
    expect(approvalCard).toContain("Ask for changes");
    expect(approvalActions).toContain("Ask for changes");
  });
});
