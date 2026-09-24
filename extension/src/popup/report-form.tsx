import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { APP_URL } from "../lib/supabase";
import {
  clearAnnotatedResult,
  clearLastCapture,
  getAnnotatedResult,
  getLastCapture,
} from "../capture/store";
import { checkScreenshotSize, uploadScreenshotForTask } from "../submit/upload";
import { collectEnvironmentMetadata } from "../capture/environment";
import { collectPageContextOnActiveTab } from "../capture/page-context";
import { buildTaskDescription, redactPageUrl } from "../submit/describe";
import { getLastReportContext, setLastReportContext } from "../state/preferences";
import { getDraft, saveDraft, clearDraft, type ReportDraft } from "../submit/draft";
import { classifySubmitError, SubmitErrorMessage, type SubmitErrorInfo } from "./errors";
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
// (environment) after the reporter's own words. Environment
// metadata is collected fresh at submit time via F288's
// collectEnvironmentMetadata() (using the connected session's own reporter
// id/email, passed down from Popup.tsx). (Element picking and console/network capture have been removed.)
//
// Sensible defaults (per this feature's clarification, "everything else
// optional"): status defaults to "Project default" (omitted from the
// request; the server resolves the project's first not-started column), no
// assignee, no priority, no due date.

// Audit SEC-EXT-06: statuses are per-project (`project_statuses`, the v2
// set by default) and come from GET /api/extension/context — no hard-coded
// list here. "" means "project default": the field is omitted from the
// request and the server resolves the project's first not-started column.
type ProjectStatus = { name: string; category: string };

const PRIORITY_OPTIONS = [
  { value: "", label: "No priority" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "backlog", label: "Backlog" },
] as const;

type Workspace = { id: string; name: string; slug: string };
type Project = { id: string; name: string; statuses?: ProjectStatus[] };
type Member = { id: string; name: string };
type TaskType = { id: string; name: string };

type WorkspacesState =
  | { kind: "loading" }
  | { kind: "loaded"; workspaces: Workspace[] }
  | { kind: "error"; reason: string };

type WorkspaceContextState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; projects: Project[]; members: Member[]; taskTypes: TaskType[] }
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
  | { kind: "error"; info: SubmitErrorInfo };

export function ReportForm({
  accessToken,
  reporterId,
  reporterEmail,
  onCaptureReset,
}: {
  accessToken: string;
  reporterId?: string | null;
  reporterEmail?: string | null;
  /** Called once a report no longer needs the current screenshot, so the
   * popup can drop its own capture preview state (SEC-EXT-05). */
  onCaptureReset?: () => void;
}) {
  const [workspacesState, setWorkspacesState] = useState<WorkspacesState>({
    kind: "loading",
  });
  const [workspaceId, setWorkspaceId] = useState("");
  const [workspaceContext, setWorkspaceContext] = useState<WorkspaceContextState>({
    kind: "idle",
  });
  const [projectId, setProjectId] = useState("");
  const [taskTypeId, setTaskTypeId] = useState("");
  const [status, setStatus] = useState("");
  // Audit SEC-EXT-04: the page URL goes into the task description as
  // origin + path only by default — query strings and fragments routinely
  // carry OAuth codes, access tokens, reset links and PII. Opt-in per report.
  const [includeFullUrl, setIncludeFullUrl] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [priority, setPriority] = useState<string>("");
  const [dueDate, setDueDate] = useState("");
  const [submitState, setSubmitState] = useState<SubmitState>({ kind: "idle" });

  // F297 (AS-565): the persisted, unsent draft from a prior failed/aborted
  // submit attempt, if any — read once on mount. Takes priority over F296's
  // "last used workspace/project" remembered context below: an active draft
  // means the reporter is mid-way through a specific, already-typed report
  // they haven't successfully submitted yet, which is more specific and more
  // urgent than "the workspace/project they happened to use last time."
  const [draftState, setDraftState] = useState<
    { kind: "loading" } | { kind: "loaded"; draft: ReportDraft | null }
  >({ kind: "loading" });
  const appliedDraftFields = useRef(false);
  const appliedDraftWorkspace = useRef(false);
  const appliedDraftProject = useRef(false);
  // The draft's screenshot data URL, once restored — fed into submit's
  // screenshot resolution below alongside the in-memory capture/annotation
  // singletons, and rendered as a visible preview (data-testid
  // "report-form-draft-image") so restoration is provably real, not just
  // "the same session still had it in memory."
  const [restoredDraftImage, setRestoredDraftImage] = useState<string | null>(null);
  const [draftImageOmittedNotice, setDraftImageOmittedNotice] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getDraft().then((draft) => {
      if (!cancelled) setDraftState({ kind: "loaded", draft });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Restore the draft's plain fields (independent of any server data)
  // exactly once, as soon as the draft has loaded.
  useEffect(() => {
    if (draftState.kind !== "loaded" || !draftState.draft || appliedDraftFields.current) return;
    appliedDraftFields.current = true;
    const d = draftState.draft;
    setStatus(d.status);
    setTitle(d.title);
    setDescription(d.description);
    setAssigneeId(d.assigneeId);
    setPriority(d.priority);
    setDueDate(d.dueDate);
    if (d.imageDataUrl) setRestoredDraftImage(d.imageDataUrl);
    if (d.imageOmitted) setDraftImageOmittedNotice(true);
  }, [draftState]);

  // Restore the draft's workspace once the real, scoped workspace list has
  // loaded — only if it's still one of the caller's real options (same
  // "never widen what's offered" rule AS-557/F296's remembered-context
  // preselection already follows).
  useEffect(() => {
    if (
      workspacesState.kind !== "loaded" ||
      draftState.kind !== "loaded" ||
      !draftState.draft ||
      appliedDraftWorkspace.current
    ) {
      return;
    }
    appliedDraftWorkspace.current = true;
    const match = workspacesState.workspaces.find((ws) => ws.id === draftState.draft!.workspaceId);
    if (match) setWorkspaceId(match.id);
  }, [workspacesState, draftState]);

  // Restore the draft's project once that workspace's real project list has
  // loaded and is actually the draft's own workspace (not a stale project
  // id left over from a different workspace).
  useEffect(() => {
    if (
      workspaceContext.kind !== "loaded" ||
      draftState.kind !== "loaded" ||
      !draftState.draft ||
      appliedDraftProject.current ||
      workspaceId !== draftState.draft.workspaceId
    ) {
      return;
    }
    appliedDraftProject.current = true;
    const match = workspaceContext.projects.find((p) => p.id === draftState.draft!.projectId);
    if (match) setProjectId(match.id);
  }, [workspaceContext, draftState, workspaceId]);

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
      appliedRememberedWorkspace.current ||
      // F297: an active unsent draft takes priority — never overwrite it
      // with the last-used-but-unrelated workspace/project once the draft
      // has actually been confirmed absent (draftState not yet "loaded"
      // also defers here, so this never races the draft's own effect
      // above).
      draftState.kind !== "loaded" ||
      draftState.draft
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
  }, [workspacesState, rememberedContext, draftState]);

  useEffect(() => {
    if (!workspaceId) {
      setWorkspaceContext({ kind: "idle" });
      setProjectId("");
      setTaskTypeId("");
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
        const taskTypes: TaskType[] = body.taskTypes ?? [];
        const qaIssue = taskTypes.find((t) => t.name.toLowerCase() === "qa issue");
        if (qaIssue) setTaskTypeId(qaIssue.id);
        setWorkspaceContext({
          kind: "loaded",
          projects: body.projects ?? [],
          members: body.members ?? [],
          taskTypes,
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
      workspaceId !== rememberedContext.workspaceId ||
      // F297: same draft-takes-priority rule as the workspace effect above.
      draftState.kind !== "loaded" ||
      draftState.draft
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
  }, [workspaceContext, rememberedContext, workspaceId, draftState]);

  const projectStatuses = useMemo<ProjectStatus[]>(
    () =>
      workspaceContext.kind === "loaded"
        ? (workspaceContext.projects.find((p) => p.id === projectId)?.statuses ?? [])
        : [],
    [workspaceContext, projectId],
  );

  // A status only makes sense for the project it came from: drop a
  // restored/previous choice the selected project doesn't have (e.g. a
  // pre-v2 "todo" from an old draft) so the server default applies.
  useEffect(() => {
    if (workspaceContext.kind !== "loaded" || !projectId || !status) return;
    if (!projectStatuses.some((s) => s.name === status)) setStatus("");
  }, [workspaceContext, projectId, status, projectStatuses]);

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
    // F297: a screenshot restored from a persisted draft (this popup mount
    // never itself captured/annotated one) is the last-resort fallback —
    // a live in-memory capture/annotation from THIS mount always wins if
    // one exists.
    const annotated = getAnnotatedResult();
    const lastCapture = getLastCapture();
    const screenshot =
      annotated ?? (lastCapture?.ok ? lastCapture : null) ?? (restoredDraftImage ? { dataUrl: restoredDraftImage } : null);

    // F297 (AS-565): persist the draft — every field plus the resolved
    // screenshot — at the moment a submit is ATTEMPTED, before the size
    // check and before the network call. This is what makes "an offline
    // submission ... loses neither typed input nor annotations" hold even
    // if the popup/extension is killed mid-network-call: the draft is
    // already safely on disk before that call is even made. Never blocks
    // or fails the actual submit attempt (saveDraft never throws).
    await saveDraft(
      { workspaceId, projectId, status, title, description, assigneeId, priority, dueDate },
      screenshot,
    );

    // AS-566: the size check happens BEFORE the task is created — an
    // oversized screenshot is rejected here and no fetch to
    // /api/extension/tasks is ever made for this submission.
    if (screenshot) {
      const sizeCheck = checkScreenshotSize(screenshot);
      if (!sizeCheck.ok) {
        setSubmitState({
          kind: "error",
          info: classifySubmitError({ networkFailure: false, serverMessage: sizeCheck.error }),
        });
        return;
      }
    }

    setSubmitState({ kind: "submitting" });

    // F295 (AS-560): build the combined description — reporter's own text
    // first, then a structured metadata block. Environment metadata is
    // collected fresh here (not cached) so `capturedAt`/URL/viewport
    // reflect the moment of submission. `collectEnvironmentMetadata` never
    // throws (see environment.ts), so no try/catch is needed around it.
    //
    // F342 (M19 scrutiny BLOCKER-2, AS-548): URL/viewport/DPR must describe
    // the real page the reporter is filing a bug about, not this popup
    // document. `collectPageContextOnActiveTab()` reads those three fields
    // from the active tab's own page context (same
    // `chrome.scripting.executeScript` mechanism the element picker already
    // uses) and is passed in here — `collectEnvironmentMetadata` only falls
    // back to its own (popup-scoped) ambient reads if this resolves to
    // `null` (e.g. no active tab, or a page the extension cannot script).
    const pageContext = await collectPageContextOnActiveTab();
    const environment = collectEnvironmentMetadata(
      {
        id: reporterId ?? null,
        email: reporterEmail ?? null,
      },
      pageContext,
    );
    const finalDescription = buildTaskDescription({
      reporterText: description.trim(),
      environment: {
        ...environment,
        pageUrl: redactPageUrl(environment.pageUrl, includeFullUrl),
      },
      element: null,
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
          status: status || undefined,
          priority: priority || undefined,
          assigneeId: assigneeId || undefined,
          dueDate: dueDate || undefined,
          taskTypeId: taskTypeId || undefined,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSubmitState({
          kind: "error",
          info: classifySubmitError({ networkFailure: false, status: res.status, serverMessage: body.error }),
        });
        return;
      }

      const taskId: string = body.task.id;
      const taskKey: string | null = body.taskKey ?? null;
      const boardPath: string | null = body.boardPath ?? null;

      // F297 (AS-565): the task now genuinely exists — clear the persisted
      // draft so a stale "restore this abandoned draft?" state never lingers
      // after the reporter has already successfully reported the bug.
      // `.catch(() => {})` (not awaited-and-thrown) so a failure here can
      // never surface as a false "offline"/error state on a submit that
      // already genuinely succeeded — this whole block still runs inside
      // this function's outer try/catch, which exists to classify *submit*
      // failures, not draft-cleanup failures.
      clearDraft().catch(() => {});

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
          discardScreenshot();
          return;
        }
      }

      discardScreenshot();
      setSubmitState({ kind: "success", taskId, taskKey, boardPath });
    } catch {
      // F297 (AS-565): `fetch()` itself threw — no HTTP response was ever
      // received. This is the offline/network-failure signal (see
      // errors.tsx's doc comment for why this, not `navigator.onLine`
      // alone, is the classification's primary input). The draft was
      // already persisted above, before this fetch was even attempted, so
      // nothing typed or annotated is lost.
      setSubmitState({
        kind: "error",
        info: classifySubmitError({ networkFailure: true }),
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
  // Audit SEC-EXT-05: a filed report's screenshot must never be re-attached
  // to the next one (it used to be, even after switching workspace) — clear
  // every place a screenshot can come from: the module store (plain and
  // annotated), a restored draft image, and the popup's own preview state.
  function discardScreenshot() {
    clearLastCapture();
    clearAnnotatedResult();
    setRestoredDraftImage(null);
    setDraftImageOmittedNotice(false);
    onCaptureReset?.();
  }

  function reportAnother() {
    discardScreenshot();
    setIncludeFullUrl(false);
    setStatus("");
    setTitle("");
    setDescription("");
    setAssigneeId("");
    setPriority("");
    setDueDate("");
    // keep taskTypeId (workspace context hasn't changed, QA issue should stay selected)
    setSubmitState({ kind: "idle" });
  }

  if (workspacesState.kind === "loading") {
    return (
      <p data-testid="report-form-loading" className="pm-meta" style={{ margin: 0 }}>
        Loading workspaces&hellip;
      </p>
    );
  }

  if (workspacesState.kind === "error") {
    return (
      <p data-testid="report-form-workspaces-error" className="pm-body" style={{ margin: 0, color: "var(--pm-error)" }}>
        {workspacesState.reason}
      </p>
    );
  }

  if (workspacesState.workspaces.length === 0) {
    return (
      <p data-testid="report-form-no-workspaces" className="pm-meta" style={{ margin: 0 }}>
        You don't belong to any workspaces yet. Join or create one in pm-app first.
      </p>
    );
  }

  return (
    <form data-testid="report-form" onSubmit={handleSubmit}>
      {restoredDraftImage && (
        <div className="pm-banner pm-banner-info">
          <div>
            <p style={{ margin: "0 0 var(--pm-space-2)" }}>
              Restored from an unsent draft — your screenshot is still attached:
            </p>
            <img
              data-testid="report-form-draft-image"
              src={restoredDraftImage}
              alt="Restored draft screenshot"
              style={{ maxWidth: "100%", border: "1px solid var(--pm-border)", borderRadius: "var(--pm-radius-sm)" }}
            />
          </div>
        </div>
      )}

      {draftImageOmittedNotice && !restoredDraftImage && (
        <p
          data-testid="report-form-draft-image-omitted"
          className="pm-banner pm-banner-warning"
        >
          Your typed report was restored from an earlier attempt, but the screenshot was too
          large to save for retry — please recapture it if you still want to attach one.
        </p>
      )}

      <div className="pm-field pm-field-primary">
        <label htmlFor="report-workspace" className="pm-field-label">
          Workspace
        </label>
        <select
          id="report-workspace"
          data-testid="report-form-workspace"
          className="pm-select"
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
        <p data-testid="report-form-context-loading" className="pm-meta" style={{ margin: "0 0 var(--pm-space-2)" }}>
          Loading projects&hellip;
        </p>
      )}

      {workspaceContext.kind === "error" && (
        <p
          data-testid="report-form-context-error"
          className="pm-body"
          style={{ margin: "0 0 var(--pm-space-2)", color: "var(--pm-error)" }}
        >
          {workspaceContext.reason}
        </p>
      )}

      {workspaceContext.kind === "loaded" && (
        <>
          <div className="pm-field pm-field-primary">
            <label htmlFor="report-project" className="pm-field-label">
              Project
            </label>
            <select
              id="report-project"
              data-testid="report-form-project"
              className="pm-select"
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

          {workspaceContext.kind === "loaded" && workspaceContext.taskTypes.length > 0 && (
            <div className="pm-field pm-field-primary">
              <label htmlFor="report-task-type" className="pm-field-label">
                Task type
              </label>
              <select
                id="report-task-type"
                data-testid="report-form-task-type"
                className="pm-select"
                value={taskTypeId}
                onChange={(e) => setTaskTypeId(e.target.value)}
              >
                <option value="">No type</option>
                {workspaceContext.taskTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="pm-field pm-field-primary">
            <label htmlFor="report-status" className="pm-field-label">
              Status
            </label>
            <select
              id="report-status"
              data-testid="report-form-status"
              className="pm-select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">Project default</option>
              {projectStatuses.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="pm-field pm-field-primary">
            <label htmlFor="report-title" className="pm-field-label">
              Title
            </label>
            <input
              id="report-title"
              data-testid="report-form-title"
              className="pm-input"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="pm-field-group-divider" />

          <div className="pm-field pm-field-optional">
            <label htmlFor="report-description" className="pm-field-label">
              Description
            </label>
            <textarea
              id="report-description"
              data-testid="report-form-description"
              className="pm-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <label
              htmlFor="report-include-full-url"
              className="pm-meta"
              style={{ display: "flex", alignItems: "center", gap: "var(--pm-space-2)", marginTop: "var(--pm-space-2)" }}
            >
              <input
                id="report-include-full-url"
                data-testid="report-form-include-full-url"
                type="checkbox"
                checked={includeFullUrl}
                onChange={(e) => setIncludeFullUrl(e.target.checked)}
              />
              Include full page URL (query and #fragment)
            </label>
          </div>

          <div className="pm-field pm-field-optional">
            <label htmlFor="report-assignee" className="pm-field-label">
              Assignee
            </label>
            <select
              id="report-assignee"
              data-testid="report-form-assignee"
              className="pm-select"
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

          <div className="pm-field pm-field-optional">
            <label htmlFor="report-priority" className="pm-field-label">
              Priority
            </label>
            <select
              id="report-priority"
              data-testid="report-form-priority"
              className="pm-select"
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

          <div className="pm-field pm-field-optional">
            <label htmlFor="report-due-date" className="pm-field-label">
              Due date
            </label>
            <input
              id="report-due-date"
              data-testid="report-form-due-date"
              className="pm-input"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="pm-btn pm-btn-primary"
            data-testid="report-form-submit"
            disabled={submitState.kind === "submitting" || !projectId || !title.trim()}
            style={{ width: "100%", marginTop: "var(--pm-space-2)" }}
          >
            {submitState.kind === "submitting" ? "Creating task…" : "Create task"}
          </button>

          {submitState.kind === "success" && (
            <div data-testid="report-form-success" style={{ marginTop: "var(--pm-space-3)" }}>
              <ReportSuccess
                taskKey={submitState.taskKey}
                boardPath={submitState.boardPath}
                attachmentWarning={submitState.attachmentWarning}
                onReportAnother={reportAnother}
              />
            </div>
          )}

          {submitState.kind === "error" && <SubmitErrorMessage info={submitState.info} />}
        </>
      )}
    </form>
  );
}
