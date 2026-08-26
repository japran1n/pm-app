import { notFound, redirect } from "next/navigation";
import Link from "next/link";

import { signOut } from "@/lib/actions/auth";
import { canViewClientPortal } from "@/lib/auth/permissions";
import { getWorkspaceRoleForCurrentUser } from "@/lib/queries/portal";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

// C3 (docs/client-portal-plan.md): the client portal's own shell.
//
// URL shape: `/portal/<workspaceSlug>`, NOT `/w/<slug>/portal` as the plan
// originally sketched. Two route groups cannot both own the `w/[slug]`
// segment, and a top-level path turns out to be the better answer anyway —
// there is no URL under which a client is inside the team app's routing at
// all, so no future page added under `/w/*` can accidentally inherit a
// client session.
//
// This layout is chrome, not a security boundary. RLS is
// (20260902010000 / 20260902020000): a client who edits the URL, replays a
// request, or calls PostgREST directly still sees only shared tasks. What
// this adds is that the two audiences never see each other's UI — a client
// is redirected here from the app, and a team member is redirected out of
// here into the app, so the portal never becomes a second, weaker view of
// the same data for staff.
export const dynamic = "force-dynamic";

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  // Same reasoning as the workspace layout's own lookup: RLS collapses
  // "doesn't exist", "soft-deleted" and "not a member" into one empty
  // result, so all three end at the same generic 404 and none of them
  // confirms the workspace exists.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id, name, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();

  if (!workspace) {
    notFound();
  }

  const role = await getWorkspaceRoleForCurrentUser(workspace.id, user.id);

  if (!role) {
    notFound();
  }

  // A team member who lands here is sent to the app they actually belong
  // in, rather than being shown a stripped-down view of their own data.
  if (!canViewClientPortal({ role: role as never })) {
    redirect(`/w/${workspace.slug}`);
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Link
            href={`/portal/${workspace.slug}`}
            className="flex flex-col gap-0.5"
          >
            <span className="text-sm font-semibold tracking-tight">
              {workspace.name}
            </span>
            <span className="text-xs text-muted-foreground">Client portal</span>
          </Link>

          <div className="flex items-center gap-2">
            <nav className="flex items-center gap-1">
              <Link
                href={`/portal/${workspace.slug}`}
                className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Projects
              </Link>
              <Link
                href={`/portal/${workspace.slug}/requests`}
                className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                Requests
              </Link>
            </nav>
            <ThemeToggle />
            <form action={signOut}>
              <Button type="submit" variant="ghost" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        {children}
      </main>
    </div>
  );
}
