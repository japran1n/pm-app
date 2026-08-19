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
  ]),
]);

export default eslintConfig;
