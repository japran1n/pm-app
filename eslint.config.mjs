import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The extension/ workspace is a separate MV3 build with its own
    // tsconfig/eslint config (chrome.* globals, no Next runtime) — see
    // missions/20260818-213033/handoffs/F280-handoff.md Decisions Made.
    "extension/**",
    // Mission-orchestration artifacts, not app code (audit noise rule).
    "missions/**",
  ]),
  // Underscore prefix is this repo's established "intentionally unused"
  // convention (mock callback args in tests, destructure-and-drop). Teach
  // the rule about it instead of accumulating warnings.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_?e?$",
        },
      ],
    },
  },
  // ARCH-002: server actions must not hand-roll auth. Resolve identity via
  // the request-cached `getCurrentUser()` (lib/auth/current-user.ts) or the
  // `withAuthz` wrapper (lib/actions/authz.ts) — never a raw
  // `supabase.auth.getUser()` per action, which costs one uncached Auth
  // round trip per call.
  //
  // ARCH-003: server actions must obtain the admin Supabase client from the
  // withAuthz pipeline's ctx.admin (which is constructed after auth checks
  // pass in lib/actions/authz.ts), not by calling createAdminClient()
  // directly. A bare createAdminClient() call in an action gives admin-level
  // DB access before any authorization check and bypasses the withAuthz
  // audit trail. Exceptions must be justified inline with
  // // eslint-disable-next-line no-restricted-syntax -- ARCH-003: <reason>
  {
    files: ["lib/actions/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'CallExpression[callee.property.name="getUser"][callee.object.property.name="auth"]',
          message:
            "Do not call supabase.auth.getUser() directly in lib/actions. Use getCurrentUser() from @/lib/auth/current-user (request-cached) or wrap the action with withAuthz from @/lib/actions/authz.",
        },
        {
          selector: "CallExpression[callee.name='createAdminClient']",
          message:
            "ARCH-003: Obtain the admin client from withAuthz ctx.admin (lib/actions/authz.ts) — it is constructed only after authorization checks pass. If this call site is already guarded by an explicit auth check, add: // eslint-disable-next-line no-restricted-syntax -- ARCH-003: <reason>",
        },
      ],
    },
  },
]);

export default eslintConfig;
