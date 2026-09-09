// Single entrypoint for the "kitchen sink" demo-data seed.
//
// Runs Part A (wipe + 6 demo auth users + "Goodguys Demo" workspace +
// membership) then Part B (one fully-populated project inside that
// workspace) and prints one final, copy-paste-friendly summary.
//
// Run: npx tsx --env-file=.env scripts/seed-full-demo.ts
// (equivalent: npm run seed:full-demo, see package.json)

import { seedDemoTeam, DEMO_WORKSPACE_SLUG } from "./seed-demo-team";
import { createFullDemoProject } from "../lib/seed/full-demo-project";

async function main() {
  console.log("=== Goodguys Demo — full kitchen-sink seed ===\n");

  const team = await seedDemoTeam();

  console.log("\n[seed-full-demo] Seeding full project content...");
  const memberUserIds = Object.fromEntries(
    Object.entries(team.users).map(([role, user]) => [role, user.id]),
  ) as Record<keyof typeof team.users, string>;
  const memberCredentials = Object.fromEntries(
    Object.entries(team.users).map(([role, user]) => [
      role,
      { email: user.email, password: team.password },
    ]),
  ) as Record<keyof typeof team.users, { email: string; password: string }>;
  const project = await createFullDemoProject(
    team.workspaceId,
    memberUserIds,
    memberCredentials,
  );

  if (!project.ok) {
    console.error(`\n[seed-full-demo] Project content seed FAILED: ${project.error}`);
    console.error(
      "The workspace and 6 demo accounts above were still created successfully; only the project content step failed. Re-run this script to retry (it wipes and rebuilds everything).",
    );
    process.exit(1);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  console.log("\n================================================================");
  console.log("  GOODGUYS DEMO — READY");
  console.log("================================================================");
  console.log(`  Workspace: ${team.workspaceSlug} (${team.workspaceId})`);
  console.log(`  App URL:   ${appUrl}/w/${team.workspaceSlug}`);
  console.log(`  Project:   ${project.data.projectName} (${project.data.tasksCreated} tasks)`);
  console.log("");
  console.log("  Sign in with any of these accounts (same password for all 6):");
  console.log("");
  for (const [role, user] of Object.entries(team.users)) {
    console.log(`    ${role.padEnd(7)}  ${user.email}`);
  }
  console.log("");
  console.log(`    Password: ${team.password}`);
  console.log("================================================================\n");
}

main().catch((error) => {
  console.error("[seed-full-demo] FAILED:", error);
  process.exit(1);
});

export { DEMO_WORKSPACE_SLUG };
