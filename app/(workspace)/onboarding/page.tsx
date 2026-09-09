import { redirect } from "next/navigation";

import { CreateWorkspaceForm } from "@/components/onboarding/create-workspace-form";
import { createClient } from "@/lib/supabase/server";
import { getDefaultWorkspaceSlug } from "@/lib/queries/workspaces";
import { Logo } from "@/components/brand/logo";

// Server Component shell (primary content server-rendered, AS-155); the
// interactive create-workspace form is the sole Client Component boundary.
//
// AS-005: "no existing workspace membership" is a condition this page
// enforces itself, not just something the auth callback route happens to
// route around. A signed-in user who already has an active membership and
// navigates here directly (bookmark, back button, typed URL) is redirected
// to their default workspace instead of being shown the create-workspace
// form again — same "most-recently-created active membership" rule the
// callback route uses, shared via lib/queries/workspaces.ts so the two
// call sites can't drift. Only a user with zero active memberships sees
// the form below.
export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const slug = await getDefaultWorkspaceSlug(supabase, user.id);
    if (slug) {
      redirect(`/w/${slug}`);
    }
  }

  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-10 p-6">
      <Logo className="h-5 w-auto text-foreground" />

      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Create your workspace
          </h1>
          <p className="text-sm text-muted-foreground">
            Give your workspace a name. You can invite teammates after.
          </p>
        </div>
        <CreateWorkspaceForm />
      </div>
    </main>
  );
}
