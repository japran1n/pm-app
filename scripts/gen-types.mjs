// Regenerates lib/supabase/database.types.ts from the linked remote
// Supabase project's live schema via the CLI's `gen types` command.
//
// Uses `--project-id` (not a local `supabase db` connection) for the same
// reason scripts/apply-migration.mjs uses the Management API directly:
// this project is remote-only, there is no local Supabase stack or
// database password in this environment. `supabase gen types typescript
// --project-id <ref>` authenticates with the Supabase CLI's own login/
// access-token state (SUPABASE_ACCESS_TOKEN in .env), not a DB password.
//
// Run:  npm run db:gen-types

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const OUTPUT_PATH = "lib/supabase/database.types.ts";

if (!PROJECT_REF) {
  console.error("Missing SUPABASE_PROJECT_REF in .env");
  process.exit(1);
}

try {
  const output = execFileSync(
    "npx",
    ["supabase", "gen", "types", "typescript", "--project-id", PROJECT_REF],
    { encoding: "utf8" },
  );
  writeFileSync(OUTPUT_PATH, output);
  console.log(`Wrote ${OUTPUT_PATH} (${output.split("\n").length} lines)`);
} catch (error) {
  console.error("supabase gen types typescript failed:", error.message);
  process.exit(1);
}
