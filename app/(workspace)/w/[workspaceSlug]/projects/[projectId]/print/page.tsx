// Print/export project summary — a clean, print-optimized snapshot of a
// project for INTERNAL meetings (explicitly not a client-facing invoicing
// artifact, per this feature's own spec). Opened in a new tab from the
// project overview/settings page's "Print/Export summary" button; the
// user then uses the browser's own "Print to PDF" (Cmd+P) to save it —
// no server-side PDF generation, matching this feature's own "don't add
// a new dependency when the browser does this already" answer.
//
// Server Component (same "server-fetch, thin/no client boundary" pattern
// as the rest of this project's detail routes) — everything here is a
// read-only snapshot, so there's no interactive state to hydrate at all.
// Access mirrors the project settings page's own gate (RLS-scoped
// `projects` select via `is_project_visible_to`, collapsing "doesn't
// exist"/"different workspace"/"private, not a member" into the same
// notFound()) rather than the parent layout's admin-client
// `getProjectById` — this route has no membership-gated parent-layout
// guard of its own beyond workspace membership, so it re-checks
// project-level visibility itself, exactly like settings/page.tsx does.
import { notFound, redirect } from "next/navigation";

import { getCurrentUser, getRequestClient } from "@/lib/auth/current-user";
import { getProjectPhasesForTeam } from "@/lib/queries/phases";
import { getProjectListTasks } from "@/lib/queries/tasks";
import { getProjectMembers } from "@/lib/queries/project-members";
import { resolvePeople } from "@/lib/queries/people";
import { computeProjectHealth, type ProjectHealth } from "@/lib/projects/compute-health";
import {
  PrintSummary,
  type PrintSummaryMember,
  type PrintSummaryTask,
} from "@/components/project/print-summary";
import "./print-summary.css";

export default async function ProjectPrintSummaryPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  const supabase = await getRequestClient();

  const [{ user }, { data: workspace }] = await Promise.all([
    getCurrentUser(),
    supabase.from("workspaces").select("id, name").eq("slug", workspaceSlug).maybeSingle(),
  ]);

  if (!user) {
    redirect("/sign-in");
  }

  if (!workspace) {
    notFound();
  }

  // RLS-scoped (`projects_select_active_members` -> `is_project_visible_to`),
  // same collapsed not-found handling as settings/page.tsx.
  const { data: project } = await supabase
    .from("projects")
    .select("id, workspace_id, name, description")
    .eq("id", projectId)
    .eq("workspace_id", workspace.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const [phases, tasksResult, members] = await Promise.all([
    getProjectPhasesForTeam(project.id),
    getProjectListTasks(project.id),
    getProjectMembers(project.id),
  ]);
  // P2-33: print view uses the task list as-is; hasMore is not surfaced here
  // since this is a static export and adding rows would require pagination.
  const tasks = tasksResult.tasks;

  const currentPhase = phases.find((phase) => phase.state === "active") ?? null;

  const openTasks = tasks.filter((task) => task.status !== "done");

  const now = new Date();
  const overdueTaskCount = openTasks.filter(
    (task) => task.dueDate && new Date(task.dueDate).getTime() < now.getTime(),
  ).length;

  const health: ProjectHealth = computeProjectHealth({
    now,
    overdueTaskCount,
    totalTaskCount: tasks.length,
    currentPhase: currentPhase
      ? {
          state: currentPhase.state,
          plannedStart: currentPhase.plannedStart,
          plannedEnd: currentPhase.plannedEnd,
        }
      : null,
  });

  const peopleIds = new Set<string>();
  for (const task of openTasks) {
    if (task.assigneeId) peopleIds.add(task.assigneeId);
  }
  for (const member of members) {
    peopleIds.add(member.userId);
  }
  const people = await resolvePeople(Array.from(peopleIds));

  const printTasks: PrintSummaryTask[] = openTasks.map((task) => {
    const person = task.assigneeId ? people.get(task.assigneeId) : undefined;
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      assigneeName: person?.name ?? person?.email ?? null,
      dueDate: task.dueDate,
    };
  });

  const printMembers: PrintSummaryMember[] = members.map((member) => {
    const person = people.get(member.userId);
    return {
      id: member.id,
      name: person?.name ?? null,
      email: person?.email ?? null,
      projectRole: member.projectRole,
    };
  });

  return (
    <div className="print-summary-page">
      <PrintSummary
        workspaceName={workspace.name}
        projectName={project.name}
        projectDescription={project.description}
        currentPhase={
          currentPhase ? { name: currentPhase.name, state: currentPhase.state } : null
        }
        health={health}
        tasks={printTasks}
        members={printMembers}
        generatedAt={now.toISOString()}
      />
    </div>
  );
}
