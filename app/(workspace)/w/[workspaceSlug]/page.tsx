import { redirect } from "next/navigation";
import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

// Minimal placeholder proving the F014 chain (layout guard + switcher)
// works end to end. The real dashboard is F073+; out of scope here.
export default async function WorkspacePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("name")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  // The layout above already redirects away when the workspace can't be
  // resolved, so this is just a defensive fallback, not the primary guard.
  if (!workspace) {
    redirect("/onboarding");
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6">
      <h1 className="text-lg font-semibold">Welcome to {workspace.name}</h1>
      {/* F027: natural next stop from the workspace home placeholder. */}
      <Link
        href={`/w/${workspaceSlug}/projects`}
        className="text-sm text-muted-foreground underline"
      >
        View projects
      </Link>
    </div>
  );
}
