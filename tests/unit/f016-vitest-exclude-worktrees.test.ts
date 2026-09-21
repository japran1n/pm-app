// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SB-004 (behavioural, F026): ask vitest itself what it would collect under
// the repo's default config, with a real probe test file planted under
// `.claude/`, instead of string-matching the config source.
describe("F016 vitest excludes agent worktrees", () => {
  it("test_SB_004_claude_worktrees_not_collected_by_default_config", () => {
    const probeDir = join(process.cwd(), ".claude", "f026-probe");
    const probe = join(probeDir, "probe.test.ts");
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(probe, 'import {it} from "vitest"; it("x", () => {});\n');
    try {
      const out = execFileSync(
        "npx",
        ["vitest", "list", "--filesOnly", "--json"],
        { cwd: process.cwd(), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      );
      const files = (JSON.parse(out.slice(out.indexOf("["))) as { file: string }[]).map(
        (f) => f.file.replace(process.cwd() + "/", ""),
      );
      // Control: collection is non-empty and includes a known unit test...
      expect(files).toContain("tests/unit/f016-vitest-exclude-worktrees.test.ts");
      // ...and nothing under .claude/ (incl. the planted probe) is collected.
      expect(files.filter((f) => f.startsWith(".claude/"))).toEqual([]);
    } finally {
      rmSync(probeDir, { recursive: true, force: true });
    }
  }, 120_000);
});
