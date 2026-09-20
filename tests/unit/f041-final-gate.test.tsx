// F041 (AS-073, AS-074, AS-075, AS-076, AS-084): final mission gate --
// tsc/eslint/vitest/migrations:check all green, and no new runtime
// dependency was introduced by this mission's calendar-planner work.
//
// tsc/eslint/vitest are process-level gates already enforced by CI and by
// this feature's own worker run (see the handoff); re-asserting them via
// execSync here would triple the suite's wall-clock time for no extra
// signal. What genuinely needs a durable, repo-checked assertion is
// AS-084 (no new dependency) and AS-076 (migrations:check passes), since
// those are easy to silently regress in a later feature without any test
// noticing.

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_JSON_PATH = path.join(process.cwd(), "package.json");

// The mission's first feature commit (F028: "Just me / whole team"
// shortcuts) is the earliest commit touching this mission's calendar
// planner work. Diffing package.json against its parent shows exactly what
// (if anything) the mission added to dependencies.
const MISSION_START_COMMIT = "1ab50a12~1";

describe("F041 (AS-076): migrations:check passes", () => {
  it("test_AS_076_migrations_check_exits_zero", () => {
    expect(() =>
      execSync("npm run migrations:check", {
        cwd: process.cwd(),
        stdio: "pipe",
      }),
    ).not.toThrow();
  });
});

describe("F041 (AS-084): package.json gained no new runtime dependency", () => {
  it("test_AS_084_dependencies_unchanged_since_mission_start", () => {
    const diff = execSync(
      `git diff ${MISSION_START_COMMIT} -- package.json`,
      { cwd: process.cwd(), encoding: "utf-8" },
    );
    expect(diff.trim()).toBe("");
  });

  it("test_AS_084_no_calendar_planner_specific_runtime_package", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf-8")) as {
      dependencies: Record<string, string>;
    };
    // This mission (calendar planner: stacked layout, people switcher,
    // whole-team ordering) never needed a new library -- react/next/date-fns
    // and the pre-existing cmdk combobox primitive covered everything.
    const suspiciousNames = Object.keys(pkg.dependencies).filter((name) =>
      /planner|stacked-calendar|people-switcher/i.test(name),
    );
    expect(suspiciousNames).toEqual([]);
  });
});
