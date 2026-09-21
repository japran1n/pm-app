import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import config from "../../vitest.config";

describe("F016 vitest excludes agent worktrees", () => {
  it("test_SB_004_claude_worktrees_not_collected_by_default_config", () => {
    const exclude = (config.test?.exclude ?? []) as string[];
    expect(exclude).toContain(".claude/**");
  });

  it("test_SB_004_config_source_lists_claude_exclude", () => {
    const src = readFileSync("vitest.config.ts", "utf8");
    expect(src).toMatch(/"\.claude\/\*\*"/);
  });
});
