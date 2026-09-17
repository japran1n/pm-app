// F002 (AS-002, AS-003, AS-004, AS-009, AS-010): the HTML -> Webflow
// converter route's skeleton. This is deliberately a Server Component
// wrapping a Client Component -- the real editor/preview UI is built by
// F029's ConverterPage (components/webflow-tool/converter-page.tsx).
//
// AS-002: this file's own path (app/(workspace)/w/[workspaceSlug]/tools/
// webflow/page.tsx) is what makes the route live at
// /w/[workspaceSlug]/tools/webflow.
//
// AS-003/AS-004: this page adds ZERO new auth/membership logic. The
// segment layout (app/(workspace)/w/[workspaceSlug]/layout.tsx) already:
//   - redirects an unauthenticated visitor to /sign-in (AS-004), and
//   - resolves the workspace by slug via a query scoped by the
//     `workspaces_select_active_members` RLS policy, so a non-member
//     hitting this URL gets the same generic 404 every other
//     /w/[workspaceSlug]/* route gets for a workspace they don't belong
//     to (AS-003) -- see that layout's own file-header comment for the
//     full rationale (AS-144).
// This page inherits both of those for free simply by living under the
// same layout segment as its siblings (archive, my-tasks, etc.) -- it does
// not re-fetch the user, workspace, or membership itself.
//
// AS-009/AS-010: this page makes no Supabase query of its own (beyond
// whatever the shared layout already does to gate access) and fetches no
// prior session's editor content from a server. A refresh always lands on
// this same route, and the client-side ConverterPage restores editor
// content from localStorage (F027's useEditorPersistence hook) -- there is
// nothing to persist or restore server-side.
import { ConverterPage } from "@/components/webflow-tool/converter-page";

export default function WebflowConverterPage() {
  return <ConverterPage />;
}
