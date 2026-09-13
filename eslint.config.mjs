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
      ],
    },
  },
]);

export default eslintConfig;
