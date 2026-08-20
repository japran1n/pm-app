import { APP_URL } from "../lib/supabase";

// F296 (AS-563): shown after a real task is created by report-form.tsx.
// Displays the task's real human-readable key (computed server-side by
// POST /api/extension/tasks via lib/tasks/task-key.ts's formatTaskKey(),
// the same single source of truth every other surface uses) and a link
// that opens it.
//
// F246 (a deep-linked per-task route) has not landed as of this feature —
// grepped app/ and found no `[taskKey]`/task-detail dynamic route — so per
// the feature spec's own explicit fallback, the link opens the project's
// BOARD URL instead (`boardPath`, a relative path the server computed from
// the real project's workspace slug + project id; `null` only in the
// unlikely case the owning workspace couldn't be resolved, in which case
// no link is rendered).
//
// Opened via `chrome.tabs.create` (matching Popup.tsx's existing
// `openConnectFlow` pattern) rather than a plain `<a href>` — a plain link
// inside an MV3 popup document behaves oddly (the popup closes before
// navigation reliably completes, and relative/App-origin links don't
// reliably open a normal browser tab), so this mirrors the one link-opening
// pattern this extension already established.
export function ReportSuccess({
  taskKey,
  boardPath,
  attachmentWarning,
  onReportAnother,
}: {
  taskKey: string | null;
  boardPath: string | null;
  attachmentWarning?: string;
  onReportAnother: () => void;
}) {
  function openBoard() {
    if (!boardPath) return;
    chrome.tabs.create({ url: `${APP_URL}${boardPath}` });
  }

  return (
    <div data-testid="report-success">
      <p style={{ margin: "0 0 4px", fontSize: 13, color: "#1a7f37" }}>
        Task created{taskKey ? ":" : "."}
        {taskKey && (
          <>
            {" "}
            <strong data-testid="report-success-task-key">{taskKey}</strong>
          </>
        )}
      </p>

      {boardPath && (
        <button
          type="button"
          data-testid="report-success-open-board"
          onClick={openBoard}
          style={{ marginBottom: 8 }}
        >
          Open board
        </button>
      )}

      {attachmentWarning && (
        <p
          data-testid="report-form-attachment-warning"
          style={{ margin: "4px 0 8px", fontSize: 13, color: "#b45309" }}
        >
          {attachmentWarning}
        </p>
      )}

      <div>
        <button
          type="button"
          data-testid="report-success-report-another"
          onClick={onReportAnother}
        >
          Report another
        </button>
      </div>
    </div>
  );
}
