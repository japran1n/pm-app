import { CreateWorkspaceForm } from "@/components/onboarding/create-workspace-form";

// Server Component shell (primary content server-rendered, AS-155); the
// interactive create-workspace form is the sole Client Component boundary.
//
// AS-005: shown when the signed-in user has zero workspace memberships —
// the auth callback route (app/(auth)/auth/callback/route.ts) is what
// routes them here in the first place. This page itself does not
// re-check membership count; it is a plain create-first-workspace form,
// reachable by any authenticated user (creating an additional workspace
// later is not out of scope for this route to allow).
export default function OnboardingPage() {
  return (
    <main className="flex min-h-svh flex-1 items-center justify-center p-6">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-lg font-semibold">Create your workspace</h1>
          <p className="text-sm text-muted-foreground">
            Give your workspace a name. You can invite teammates after.
          </p>
        </div>
        <CreateWorkspaceForm />
      </div>
    </main>
  );
}
