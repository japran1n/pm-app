import { redirect } from "next/navigation";

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
    <div className="flex flex-1 items-center justify-center p-6">
      <h1 className="text-lg font-semibold">Welcome to {workspace.name}</h1>
    </div>
  );
}
