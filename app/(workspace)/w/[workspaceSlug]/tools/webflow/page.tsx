// F002 (AS-002, AS-003, AS-004, AS-009, AS-010): the HTML -> Webflow
// converter route's skeleton. This is deliberately a Server Component that
// renders a placeholder heading only -- the real editor/preview/results UI
// is built by later features (F0xx under components/webflow-tool/, per
// tech-decisions.md's file layout).
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
// this same static placeholder -- there is nothing here to persist or
// restore server-side. (Client-side localStorage restoration, if any, is
// F027's concern, not this route skeleton's.)
export default function WebflowConverterPage() {
  return (
    <div className="flex flex-col gap-1 p-6 pt-4 lg:p-8 lg:pt-8">
      <h1 className="text-xl font-semibold">HTML → Webflow converter</h1>
      <p className="text-sm text-muted-foreground">
        Paste HTML, CSS, and JS and convert it into Webflow-ready markup.
      </p>
    </div>
  );
}
