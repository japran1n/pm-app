import { useEffect, useState, type FormEvent } from "react";

import { APP_URL } from "../lib/supabase";

// F293 (AS-555, AS-556, AS-557): the actual report form — the piece that
// turns everything F280-F292 built into a real, submittable task. Populates
// its workspace/project/assignee pickers from GET /api/extension/context
// (F293's own new Route Handler), which scopes every option it returns to
// the caller's real memberships server-side (AS-557) — this component never
// filters a wider list itself, it only ever renders what the endpoint sent.
//
// Submits to POST /api/extension/tasks (F292), attaching
// `Authorization: Bearer <access_token>` from the session the popup already
// holds. This is the "wiring the extension's fetch call" F292's handoff
// explicitly left out of scope, and the "core form" F294 (attachment
// upload) and F295 (console/network-log metadata) are expected to extend
// once they exist — this component does NOT attach any screenshot,
// annotation, console log, or network log payload to the submitted task;
// extensionCreateTaskSchema (lib/validation/extension.ts) doesn't accept
// those fields yet.
//
// Sensible defaults (per this feature's clarification, "everything else
// optional"): status defaults to "todo" (also the DB column's own default,
// mirrored here so the picker shows the same value the server will actually
// persist if left untouched — see lib/validation/tasks.ts's
// createTaskSchema comment for the same rationale on the web app side), no
// assignee, no priority, no due date.

const STATUS_OPTIONS = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "in_review", label: "In review" },
  { value: "done", label: "Done" },
] as const;

const PRIORITY_OPTIONS = [
  { value: "", label: "No priority" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "backlog", label: "Backlog" },
] as const;

type Workspace = { id: string; name: string; slug: string };
type Project = { id: string; name: string };
type Member = { id: string; name: string };

type WorkspacesState =
  | { kind: "loading" }
  | { kind: "loaded"; workspaces: Workspace[] }
  | { kind: "error"; reason: string };

type WorkspaceContextState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; projects: Project[]; members: Member[] }
  | { kind: "error"; reason: string };

type SubmitState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success"; taskId: string }
  | { kind: "error"; reason: string };

export function ReportForm({ accessToken }: { accessToken: string }) {
  const [workspacesState, setWorkspacesState] = useState<WorkspacesState>({
    kind: "loading",
  });
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContextState>({
    kind: "idle",
  });
  const [projectId, setProjectId] = useState("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]["value"]>("todo");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    setWorkspacesState({ kind: "loading" });
    fetch(`${APP_URL}/api/extension/context`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setWorkspacesState({
            kind: "error",
            reason: body.error ?? "Failed to load workspaces.",
          });
          return;
        }
        const body = await res.json();
        setWorkspacesState({ kind: "loaded", workspaces: body.workspaces ?? [] });
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspacesState({ kind: "error", reason: "Failed to load workspaces." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  useEffect(() => {
    if (!workspaceId) {
      setWorkspaceContext({ kind: "idle" });
      setProjectId("");
      setAssigneeId("");
      return;
    }
    let cancelled = false;
    setWorkspaceContext({ kind: "loading" });
    setProjectId("");
    setAssigneeId("");
    fetch(
      `${APP_URL}/api/extension/context?workspaceId=${encodeURIComponent(workspaceId)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    )
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setWorkspaceContext({
            kind: "error",
            reason: body.error ?? "Failed to load projects.",
          });
          return;
        }
        const body = await res.json();
        setWorkspaceContext({
          kind: "loaded",
          projects: body.projects ?? [],
          members: body.members ?? [],
        });
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceContext({ kind: "error", reason: "Failed to load projects." });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, accessToken]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !title.trim()) return;

    setSubmitState({ kind: "submitting" });
    try {
      const res = await fetch(`${APP_URL}/api/extension/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          projectId,
          title: title.trim(),
          description: description.trim() || undefined,
          status,
          priority: priority || undefined,
          assigneeId: assigneeId || undefined,
          dueDate: dueDate || undefined,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSubmitState({
          kind: "error",
          reason: body.error ?? "Failed to create task. Your entered details are still shown above — please try again.",
        });
        return;
      }

      setSubmitState({ kind: "success", taskId: body.task.id });
    } catch {
      setSubmitState({
        kind: "error",
        reason: "Failed to create task. Your entered details are still shown above — please try again.",
      });
    }
  }

  if (workspacesState.kind === "loading") {
    return (
      <p data-testid="report-form-loading" style={{ margin: 0, color: "#666" }}>
        Loading workspaces&hellip;
      </p>
    );
  }

  if (workspacesState.kind === "error") {
    return (
      <p data-testid="report-form-workspaces-error" style={{ margin: 0, color: "#b91c1c" }}>
        {workspacesState.reason}
      </p>
    );
  }

  if (workspacesState.workspaces.length === 0) {
    return (
      <p data-testid="report-form-no-workspaces" style={{ margin: 0, color: "#666" }}>
        You don't belong to any workspaces yet. Join or create one in pm-app first.
      </p>
    );
  }

  return (
    <form data-testid="report-form" onSubmit={handleSubmit}>
      <div style={{ marginBottom: 8 }}>
        <label htmlFor="report-workspace" style={{ display: "block", fontSize: 13, marginBottom: 2 }}>
          Workspace
        </label>
        <select
          id="report-workspace"
          data-testid="report-form-workspace"
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
        >
          <option value="">Select a workspace&hellip;</option>
          {workspacesState.workspaces.map((ws) => (
            <option key={ws.id} value={ws.id}>
              {ws.name}
            </option>
          ))}
        </select>
      </div>

      {workspaceContext.kind === "loading" && (
        <p data-testid="report-form-context-loading" style={{ margin: "0 0 8px", fontSize: 13, color: "#666" }}>
          Loading projects&hellip;
        </p>
      )}

      {workspaceContext.kind === "error" && (
        <p data-testid="report-form-context-error" style={{ margin: "0 0 8px", fontSize: 13, color: "#b91c1c" }}>
          {workspaceContext.reason}
        </p>
      )}

      {workspaceContext.kind === "loaded" && (
        <>
          <div style={{ marginBottom: 8 }}>
            <label htmlFor="report-project" style={{ display: "block", fontSize: 13, marginBottom: 2 }}>
              Project
            </label>
            <select
              id="report-project"
              data-testid="report-form-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">Select a project&hellip;</option>
              {workspaceContext.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label htmlFor="report-status" style={{ display: "block", fontSize: 13, marginBottom: 2 }}>
              Status
            </label>
            <select
              id="report-status"
              data-testid="report-form-status"
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as (typeof STATUS_OPTIONS)[number]["value"])
              }
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label htmlFor="report-title" style={{ display: "block", fontSize: 13, marginBottom: 2 }}>
              Title
            </label>
            <input
              id="report-title"
              data-testid="report-form-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label htmlFor="report-description" style={{ display: "block", fontSize: 13, marginBottom: 2 }}>
              Description
            </label>
            <textarea
              id="report-description"
              data-testid="report-form-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>

          <div style={{ marginBottom: 8 }}>
            <label htmlFor="report-assignee" style={{ display: "block", fontSize: 13, marginBottom: 2 }}>
              Assignee
            </label>
            <select
              id="report-assignee"
              data-testid="report-form-assignee"
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
            >
              <option value="">Unassigned</option>
              {workspaceContext.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label htmlFor="report-priority" style={{ display: "block", fontSize: 13, marginBottom: 2 }}>
              Priority
            </label>
            <select
              id="report-priority"
              data-testid="report-form-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
            >
              {PRIORITY_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 8 }}>
            <label htmlFor="report-due-date" style={{ display: "block", fontSize: 13, marginBottom: 2 }}>
              Due date
            </label>
            <input
              id="report-due-date"
              data-testid="report-form-due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <button
            type="submit"
            data-testid="report-form-submit"
            disabled={submitState.kind === "submitting" || !projectId || !title.trim()}
          >
            {submitState.kind === "submitting" ? "Creating task…" : "Create task"}
          </button>

          {submitState.kind === "success" && (
            <p data-testid="report-form-success" style={{ margin: "8px 0 0", fontSize: 13, color: "#1a7f37" }}>
              Task created.
            </p>
          )}

          {submitState.kind === "error" && (
            <p data-testid="report-form-error" style={{ margin: "8px 0 0", fontSize: 13, color: "#b91c1c" }}>
              {submitState.reason}
            </p>
          )}
        </>
      )}
    </form>
  );
}
