// F013 (TH-030, TH-031, TH-032, TH-033, TH-036): the "Tools" index route,
// listing every tool reachable from the sidebar's own "Tools" band
// (components/nav/app-sidebar.tsx's `tools` array, F010/F011). Deliberately
// a plain Server Component with zero data fetching of its own -- exactly
// the same "adds ZERO new auth/membership logic, inherits access from the
// shared layout segment" pattern as its sibling
// tools/webflow/page.tsx already follows (see that file's own header
// comment for the full AS-003/AS-004-equivalent rationale, which applies
// unchanged here): the layout already redirects an unauthenticated visitor
// to /sign-in (TH-036) and 404s a non-member via the
// `workspaces_select_active_members` RLS-scoped query, so this page makes
// no Supabase query of its own beyond that shared check.
//
// Card content is defined in one place (the `tools` array below) so a
// third tool is a one-line addition, per this feature's own Draft scope.
import { Code2, FileCode2, Network } from "lucide-react";

import { ToolCard } from "@/components/tools/tool-card";

export default async function ToolsIndexPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  // TH-031/TH-032/TH-033: both tools from the sidebar's own "Tools" band
  // (app-sidebar.tsx), same routes/labels, listed as cards here.
  const tools = [
    {
      href: `/w/${workspaceSlug}/tools/webflow`,
      icon: Code2,
      name: "HTML → Webflow",
      description: "Convert exported HTML into Webflow-ready markup.",
    },
    {
      href: `/w/${workspaceSlug}/tools/code-editor`,
      icon: FileCode2,
      name: "Webflow Code Editor",
      description: "Edit and preview Webflow custom code snippets.",
    },
    {
      href: `/w/${workspaceSlug}/tools/sitemap`,
      icon: Network,
      name: "Sitemap Builder",
      description: "Plan website structure and share with clients.",
    },
  ];

  return (
    <div className="p-6 pt-4 lg:p-8 lg:pt-8">
      <h1 className="text-lg font-medium text-foreground">Tools</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Utilities for working with Webflow.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((tool) => (
          <ToolCard
            key={tool.href}
            href={tool.href}
            icon={tool.icon}
            name={tool.name}
            description={tool.description}
          />
        ))}
      </div>
    </div>
  );
}
