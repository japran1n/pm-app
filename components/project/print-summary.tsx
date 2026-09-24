// Project print/export summary (internal-meeting use, NOT client
// invoicing) — a clean, print-optimized read-only view of a project:
// name/description, current phase, health, open tasks grouped by status
// (title/assignee/due date only — compact, not a full task detail dump),
// and the team member list.
//
// Pure presentational component (mirrors this codebase's "pure helper /
// component + caller wires up the data" convention, e.g.
// components/portal/change-requests-table.tsx) — the `/print` page does
// all the Supabase fetching and hands this component fully-resolved,
// typed props. Kept dependency-free (no client-side interactivity, no
// buttons) since the whole point of this view is "what prints", and
// nothing here should show up in the printed/PDF output except content.

import { statusLabelFor } from "@/lib/task-colors";
import type { ProjectHealth } from "@/lib/projects/compute-health";
import { PROJECT_HEALTH_LABELS } from "@/lib/projects/compute-health";

export type PrintSummaryTask = {
  id: string;
  title: string;
  status: string;
  assigneeName: string | null;
  dueDate: string | null;
};

export type PrintSummaryMember = {
  id: string;
  name: string | null;
  email: string | null;
  projectRole: "lead" | "member";
};

export type PrintSummaryPhase = {
  name: string;
  state: "not_started" | "active" | "blocked" | "done";
};

export type PrintSummaryProps = {
  workspaceName: string;
  projectName: string;
  projectDescription: string | null;
  currentPhase: PrintSummaryPhase | null;
  /** `null` when health couldn't be computed (e.g. no phases/health data
   * available) — the section renders a plain "Not tracked" line instead
   * of a status badge in that case, rather than guessing. */
  health: ProjectHealth | null;
  tasks: PrintSummaryTask[];
  /** The project's column names in board order (by position). Statuses
   * not listed follow in first-seen order. */
  statusOrder?: string[];
  members: PrintSummaryMember[];
  generatedAt: string;
};

function groupTasksByStatus(
  tasks: PrintSummaryTask[],
  statusOrder: readonly string[],
): { status: string; tasks: PrintSummaryTask[] }[] {
  const order = [...statusOrder];
  for (const task of tasks) {
    if (!order.includes(task.status)) order.push(task.status);
  }
  return order
    .map((status) => ({ status, tasks: tasks.filter((task) => task.status === status) }))
    .filter((group) => group.tasks.length > 0);
}

function formatDueDate(dueDate: string | null): string {
  if (!dueDate) return "No due date";
  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return "No due date";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const PHASE_STATE_LABELS: Record<PrintSummaryPhase["state"], string> = {
  not_started: "Not started",
  active: "Active",
  blocked: "Blocked",
  done: "Done",
};

export function PrintSummary({
  workspaceName,
  projectName,
  projectDescription,
  currentPhase,
  health,
  tasks,
  statusOrder = [],
  members,
  generatedAt,
}: PrintSummaryProps) {
  const grouped = groupTasksByStatus(tasks, statusOrder);

  const generatedLabel = new Date(generatedAt).toLocaleString();

  return (
    <article className="print-summary">
      <header className="print-summary-header">
        <p className="print-summary-eyebrow">{workspaceName}</p>
        <h1>{projectName}</h1>
        {projectDescription && <p className="print-summary-description">{projectDescription}</p>}
        <p className="print-summary-meta">Generated {generatedLabel}</p>
      </header>

      <section className="print-summary-section" aria-label="Status">
        <h2>Status</h2>
        <dl className="print-summary-status-grid">
          <div>
            <dt>Current phase</dt>
            <dd>
              {currentPhase
                ? `${currentPhase.name} (${PHASE_STATE_LABELS[currentPhase.state]})`
                : "No active phase"}
            </dd>
          </div>
          <div>
            <dt>Health</dt>
            <dd>{health ? PROJECT_HEALTH_LABELS[health] : "Not tracked"}</dd>
          </div>
        </dl>
      </section>

      <section className="print-summary-section" aria-label="Open tasks">
        <h2>Open tasks</h2>
        {grouped.length === 0 ? (
          <p className="print-summary-empty">No open tasks.</p>
        ) : (
          grouped.map((group) => (
            <div className="print-summary-task-group" key={group.status}>
              <h3>
                {statusLabelFor(group.status)} ({group.tasks.length})
              </h3>
              <table className="print-summary-task-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Assignee</th>
                    <th>Due</th>
                  </tr>
                </thead>
                <tbody>
                  {group.tasks.map((task) => (
                    <tr key={task.id}>
                      <td>{task.title}</td>
                      <td>{task.assigneeName ?? "Unassigned"}</td>
                      <td>{formatDueDate(task.dueDate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        )}
      </section>

      <section className="print-summary-section" aria-label="Team">
        <h2>Team</h2>
        {members.length === 0 ? (
          <p className="print-summary-empty">No team members.</p>
        ) : (
          <ul className="print-summary-team-list">
            {members.map((member) => (
              <li key={member.id}>
                <span>{member.name ?? member.email ?? "Unknown"}</span>
                <span className="print-summary-team-role">
                  {member.projectRole === "lead" ? "Lead" : "Member"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
