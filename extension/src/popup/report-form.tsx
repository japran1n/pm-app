import { useEffect, useRef, useState, type FormEvent } from "react";

import { APP_URL } from "../lib/supabase";
import { getAnnotatedResult, getLastCapture } from "../capture/store";
import { checkScreenshotSize, uploadScreenshotForTask } from "../submit/upload";
import { collectEnvironmentMetadata } from "../capture/environment";
import type { PickResult } from "../capture/element-picker";
import type { ConsoleLogEntry } from "../capture/console-hook";
import type { NetworkFailureEntry } from "../capture/network-hook";
import { buildTaskDescription } from "../submit/describe";
import { getLastReportContext, setLastReportContext } from "../state/preferences";
import { ReportSuccess } from "./success";

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
// upload) extends by attaching a screenshot after task creation.
//
// F295 (AS-560): the description actually sent to the server is NOT the
// raw textarea value — it's `submit/describe.ts`'s buildTaskDescription()
// result, which appends a structured, readable technical-metadata block
// (environment, picked element, console/network excerpts) after the
// reporter's own words. Environment metadata is collected fresh at submit
// time via F288's collectEnvironmentMetadata() (using the connected
// session's own reporter id/email, passed down from Popup.tsx); the picked
// element and console/network capture state are read from whichever
// in-popup state Popup.tsx already holds and passed down as props, since
// none of those live in a shared store this component could otherwise
// reach (see each feature's own handoff).
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
  | {
      kind: "success";
      taskId: string;
      taskKey: string | null;
      boardPath: string | null;
      attachmentWarning?: string;
    }
  | { kind: "error"; reason: string };

export function ReportForm({
  accessToken,
  reporterId,
  reporterEmail,
  pickedElement,
  consoleEntries,
  networkEntries,
}: {
  accessToken: string;
  reporterId?: string | null;
  reporterEmail?: string | null;
  pickedElement?: Extract<PickResult, { ok: true }> | null;
  consoleEntries?: ConsoleLogEntry[] | null;
  networkEntries?: NetworkFailureEntry[] | null;
}) {
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

  // F296 (AS-564): the last-used workspace/project, read once from
  // chrome.storage.local via preferences.ts. Applied (at most once each)
  // once the real, currently-accessible options actually load — a
  // remembered id that's no longer in the real options (removed
  // membership, deleted project) is silently never applied rather than
  // force-selecting an invalid option or crashing (AS-557 still holds:
  // this never widens what's offered, it only preselects from what the
  // context endpoint already scoped to the caller's real memberships).
  const [rememberedContext, setRememberedContext] = useState<{
    workspaceId: string;
    projectId: string;
  } | null>(null);
  const appliedRememberedWorkspace = useRef(false);
  const appliedRememberedProject = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getLastReportContext().then((ctx) => {
      if (!cancelled) setRememberedContext(ctx);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  // F296 (AS-564): once the real, scoped workspace list has loaded, apply
  // the remembered workspace exactly once, and only if it's actually still
  // one of the caller's real options.
  useEffect(() => {
    if (
      workspacesState.kind !== "loaded" ||
      !rememberedContext ||
      appliedRememberedWorkspace.current
    ) {
      return;
    }
    appliedRememberedWorkspace.current = true;
    const match = workspacesState.workspaces.find(
      (ws) => ws.id === rememberedContext.workspaceId,
    );
    if (match) {
      setWorkspaceId(match.id);
    }
  }, [workspacesState, rememberedContext]);

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

  // F296 (AS-564): once the real, scoped project list for the (now
  // preselected or manually chosen) workspace has loaded, apply the
  // remembered project exactly once — and only when the workspace in view
  // actually matches the remembered workspace (a reporter who picked a
  // different workspace than last time should not have a stale project id
  // from a different workspace forced onto them).
  useEffect(() => {
    if (
      workspaceContext.kind !== "loaded" ||
      !rememberedContext ||
      appliedRememberedProject.current ||
      workspaceId !== rememberedContext.workspaceId
    ) {
      return;
    }
    appliedRememberedProject.current = true;
    const match = workspaceContext.projects.find(
      (p) => p.id === rememberedContext.projectId,
    );
    if (match) {
      setProjectId(match.id);
    }
  }, [workspaceContext, rememberedContext, workspaceId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!projectId || !title.trim()) return;

    // F294 (AS-559, AS-566, AS-567): resolve whatever screenshot the
    // reporter captured, if any. The annotated (flattened-with-annotations)
    // result takes priority per F285's handoff; a reporter who captured but
    // never annotated still has getLastCapture()'s pristine capture to fall
    // back to. A reporter who never captured anything at all has neither —
    // task creation proceeds exactly as F293 left it, with no upload
    // attempted (per this feature's explicit "must not require a
    // screenshot" scope note).
    const annotated = getAnnotatedResult();
    const lastCapture = getLastCapture();
    const screenshot = annotated ?? (lastCapture?.ok ? lastCapture : null);

    // AS-566: the size check happens BEFORE the task is created — an
    // oversized screenshot is rejected here and no fetch to
    // /api/extension/tasks is ever made for this submission.
    if (screenshot) {
      const sizeCheck = checkScreenshotSize(screenshot);
      if (!sizeCheck.ok) {
        setSubmitState({ kind: "error", reason: sizeCheck.error });
        return;
      }
    }

    setSubmitState({ kind: "submitting" });

    // F295 (AS-560): build the combined description — reporter's own text
    // first, then a structured metadata block. Environment metadata is
    // collected fresh here (not cached) so `capturedAt`/URL/viewport
    // reflect the moment of submission. `collectEnvironmentMetadata` never
    // throws (see environment.ts), so no try/catch is needed around it.
    const environment = collectEnvironmentMetadata({
      id: reporterId ?? null,
      email: reporterEmail ?? null,
    });
    const finalDescription = buildTaskDescription({
      reporterText: description.trim(),
      environment,
      element: pickedElement ? { selector: pickedElement.selector } : null,
      consoleEntries: consoleEntries ?? null,
      networkEntries: networkEntries ?? null,
    });

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
          description: finalDescription || undefined,
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

      const taskId: string = body.task.id;
      const taskKey: string | null = body.taskKey ?? null;
      const boardPath: string | null = body.boardPath ?? null;

      // F296 (AS-564): remember the workspace/project used for this
      // successful submit — only once the report actually succeeds, so an
      // abandoned/never-submitted form never pollutes the remembered
      // context. setLastReportContext never throws (see preferences.ts),
      // but a defensive .catch is kept anyway since this must never block
      // showing the success view.
      setLastReportContext({ workspaceId, projectId }).catch(() => {});

      // F294: the task now exists for real — the reporter's work (the text
      // report) is already safely saved regardless of what happens next.
      // A screenshot upload failure here is surfaced as a warning
      // alongside the success state, never as a reason to discard or roll
      // back the task that was just created (per this feature's clarified
      // "failure handling ... preserves the reporter's work; no silent
      // no-ops").
      if (screenshot) {
        const uploadResult = await uploadScreenshotForTask({
          accessToken,
          taskId,
          screenshot,
        });
        if (!uploadResult.ok) {
          setSubmitState({
            kind: "success",
            taskId,
            taskKey,
            boardPath,
            attachmentWarning: `Task created, but the screenshot could not be attached: ${uploadResult.error}`,
          });
          return;
        }
      }

      setSubmitState({ kind: "success", taskId, taskKey, boardPath });
    } catch {
      setSubmitState({
        kind: "error",
        reason: "Failed to create task. Your entered details are still shown above — please try again.",
      });
    }
  }

  // F296 (AS-564 "report another" path, per this feature's clarification
  // note that "several reports on one page in a row" matters for QA
  // sweeps): returns to a FRESH form — title/description/status/assignee/
  // priority/due-date all cleared back to their original defaults — but
  // workspace/project are deliberately left untouched (they're already
  // the just-remembered/just-used values, not re-fetched as if this were
  // the reporter's first-ever report).
  function reportAnother() {
    setStatus("todo");
    setTitle("");
    setDescription("");
    setAssigneeId("");
    setPriority("");
    setDueDate("");
    setSubmitState({ kind: "idle" });
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
            <div data-testid="report-form-success" style={{ marginTop: 8 }}>
              <ReportSuccess
                taskKey={submitState.taskKey}
                boardPath={submitState.boardPath}
                attachmentWarning={submitState.attachmentWarning}
                onReportAnother={reportAnother}
              />
            </div>
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
