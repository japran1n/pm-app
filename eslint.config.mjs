import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import jsxA11y from "eslint-plugin-jsx-a11y";

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
  // AS-126: jsx-a11y accessibility linting, scoped to JSX/TSX files.
  // eslint-config-next already registers the "jsx-a11y" plugin instance, so
  // we only add the recommended ruleset here (registering the plugin again
  // throws "Cannot redefine plugin").
  {
    files: ["**/*.tsx", "**/*.jsx"],
    rules: {
      ...jsxA11y.configs.recommended.rules,
    },
  },
  // AS-126: enabling jsx-a11y/recommended surfaces pre-existing violations
  // in files outside components/webflow-tool/ (this feature's scope). Per
  // the feature spec, those are not fixed here -- disabled per-file so the
  // new rule doesn't fail the whole build. Fixing them is out-of-scope work
  // for a future accessibility-focused feature (see handoff).
  {
    files: [
      "app/(workspace)/w/\\[workspaceSlug\\]/search/page.tsx",
      "components/architecture/client-component-panel.tsx",
      "components/architecture/component-panel.tsx",
      "components/architecture/component-picker.tsx",
      "components/architecture/create-page-dialog.tsx",
      "components/architecture/page-column-header.tsx",
      "components/architecture/section-card.tsx",
      "components/auth/password-sign-in-form.tsx",
      "components/board/quick-add.tsx",
      "components/board/sortable-task-card.tsx",
      "components/calendar/calendar-block-popover-form.tsx",
      "components/chat/message-composer.tsx",
      "components/chat/message-list.tsx",
      "components/chat/message-reaction-picker.tsx",
      "components/client-requests/team-request-inbox.tsx",
      "components/docs/docs-folder-row.tsx",
      "components/docs/docs-sidebar.tsx",
      "components/editor/rich-text-editor.tsx",
      "components/portal/approval-actions.tsx",
      "components/portal/approval-card.tsx",
      "components/portal/page-links-menu.tsx",
      "components/task/comment-list.tsx",
      "components/task/comment-reactions.tsx",
      "components/task/image-lightbox.tsx",
      "components/task/list-due-date-cell.tsx",
      "components/task/page-links-editor.tsx",
      "components/task/subtask-list.tsx",
      "components/task/task-list-table.tsx",
      "components/time/team-heatmap.tsx",
      "components/time/weekly-time-grid.tsx",
      "components/trash/purge-dialog.tsx",
      "components/ui/input-group.tsx",
      "components/ui/label.tsx",
      "components/views/save-view-dialog.tsx",
      "tests/unit/f251-inline-edit-permissions-realtime.test.tsx",
      "tests/unit/permission-aware-ui-gating.test.tsx",
    ],
    rules: {
      "jsx-a11y/no-autofocus": "off",
      "jsx-a11y/no-redundant-roles": "off",
      "jsx-a11y/no-noninteractive-element-to-interactive-role": "off",
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/label-has-associated-control": "off",
      "jsx-a11y/interactive-supports-focus": "off",
      "jsx-a11y/anchor-has-content": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/no-interactive-element-to-noninteractive-role": "off",
      "jsx-a11y/aria-role": "off",
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
