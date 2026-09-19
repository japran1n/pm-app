// F100 (TH-006): the Webflow Code Editor route's skeleton. This is
// deliberately a Server Component wrapping a Client Component -- the real
// editor/preview UI is built by later features (F101+/F050), mirroring the
// same pattern as the HTML -> Webflow converter route
// (app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx).
//
// This page adds ZERO new auth/membership logic. The segment layout
// (app/(workspace)/w/[workspaceSlug]/layout.tsx) already redirects an
// unauthenticated visitor to /sign-in and resolves the workspace by slug
// via a query scoped by RLS, so a non-member hitting this URL gets the
// same generic 404 every other /w/[workspaceSlug]/* route gets for a
// workspace they don't belong to. This page inherits both of those for
// free simply by living under the same layout segment as its siblings.
import { CodeEditorPage } from "@/components/code-editor/code-editor-page";

export default function WebflowCodeEditorPage() {
  return <CodeEditorPage />;
}
