/**
 * Blocks destructive seed scripts from running against a hosted Supabase project
 * unless the operator explicitly confirms the target by project ref.
 *
 * Set ALLOW_DESTRUCTIVE_SEED_ON_HOSTED=<project-ref> to allow it.
 * This mirrors the guard in tests/setup/testing-library.ts.
 */
export function assertSafeSeedTarget(scriptName) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (url.includes("localhost") || url.includes("127.0.0.1")) return;
  const ref = process.env.SUPABASE_PROJECT_REF ?? "";
  if (ref && process.env.ALLOW_DESTRUCTIVE_SEED_ON_HOSTED === ref) return;
  throw new Error(
    `[${scriptName}] Refusing to run against a hosted Supabase project.\n` +
    `  NEXT_PUBLIC_SUPABASE_URL=${url || "(not set)"}\n` +
    `  To override: ALLOW_DESTRUCTIVE_SEED_ON_HOSTED=${ref || "<project-ref>"} npm run seed:full-demo`
  );
}
