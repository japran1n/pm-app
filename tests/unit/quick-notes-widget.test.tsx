// @vitest-environment jsdom
//
// QuickNotesWidget: compact dashboard list of the caller's own quick
// notes. Verifies the checkbox toggle, add-note input, delete, and the
// clickable task/project reference chip when a note is linked.

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

const createQuickNote = vi.fn();
const toggleQuickNote = vi.fn();
const deleteQuickNote = vi.fn();
vi.mock("@/lib/actions/quick-notes", () => ({
  createQuickNote: (...args: unknown[]) => createQuickNote(...args),
  toggleQuickNote: (...args: unknown[]) => toggleQuickNote(...args),
  deleteQuickNote: (...args: unknown[]) => deleteQuickNote(...args),
}));

import { QuickNotesWidget } from "@/components/dashboard/quick-notes-widget";
import type { QuickNote } from "@/lib/queries/quick-notes";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function makeNote(overrides: Partial<QuickNote> = {}): QuickNote {
  return {
    id: "note-1",
    text: "Call the domain registrar",
    isDone: false,
    createdAt: new Date().toISOString(),
    taskId: null,
    taskKey: null,
    taskTitle: null,
    projectId: null,
    projectName: null,
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("QuickNotesWidget", () => {
  it("test_AS_quick_notes_widget_renders_an_empty_state_with_no_notes", () => {
    render(
      createElement(QuickNotesWidget, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        initialNotes: [],
      }),
    );
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("test_AS_quick_notes_widget_adds_a_note_via_the_input", async () => {
    createQuickNote.mockResolvedValue({ ok: true });
    render(
      createElement(QuickNotesWidget, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        initialNotes: [],
      }),
    );

    const input = screen.getByLabelText("New quick note");
    fireEvent.change(input, { target: { value: "Renew SSL cert" } });
    fireEvent.click(screen.getByLabelText("Add quick note"));

    expect(await screen.findByText("Renew SSL cert")).toBeInTheDocument();
    await flush();
    expect(createQuickNote).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      text: "Renew SSL cert",
    });
  });

  it("test_AS_quick_notes_widget_shows_error_toast_and_reverts_on_create_failure", async () => {
    createQuickNote.mockResolvedValue({ ok: false, error: "Something went wrong." });
    render(
      createElement(QuickNotesWidget, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        initialNotes: [],
      }),
    );

    const input = screen.getByLabelText("New quick note");
    fireEvent.change(input, { target: { value: "Renew SSL cert" } });
    fireEvent.click(screen.getByLabelText("Add quick note"));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Something went wrong."));
    await waitFor(() =>
      expect(screen.queryByText("Renew SSL cert")).not.toBeInTheDocument(),
    );
  });

  it("test_AS_quick_notes_widget_toggles_a_note_done", async () => {
    toggleQuickNote.mockResolvedValue({ ok: true });
    render(
      createElement(QuickNotesWidget, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        initialNotes: [makeNote()],
      }),
    );

    const checkbox = screen.getByLabelText('Mark "Call the domain registrar" done');
    fireEvent.click(checkbox);
    await flush();

    expect(toggleQuickNote).toHaveBeenCalledWith({ noteId: "note-1", isDone: true });
  });

  it("test_AS_quick_notes_widget_deletes_a_note", async () => {
    deleteQuickNote.mockResolvedValue({ ok: true });
    render(
      createElement(QuickNotesWidget, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        initialNotes: [makeNote()],
      }),
    );

    fireEvent.click(screen.getByLabelText('Delete "Call the domain registrar"'));
    await flush();

    expect(deleteQuickNote).toHaveBeenCalledWith({ noteId: "note-1" });
    expect(screen.queryByText("Call the domain registrar")).not.toBeInTheDocument();
  });

  it("test_AS_quick_notes_widget_shows_a_clickable_task_reference_when_linked", () => {
    render(
      createElement(QuickNotesWidget, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        initialNotes: [
          makeNote({
            id: "note-2",
            text: "Confirm scope with client",
            taskId: "task-1",
            taskKey: "PM-42",
            taskTitle: "Kickoff call",
          }),
        ],
      }),
    );

    const link = screen.getByRole("link", { name: /on task: Kickoff call/ });
    expect(link).toHaveAttribute("href", "/w/acme/t/PM-42");
  });

  it("test_AS_quick_notes_widget_shows_a_clickable_project_reference_when_linked_without_a_task", () => {
    render(
      createElement(QuickNotesWidget, {
        workspaceId: "ws-1",
        workspaceSlug: "acme",
        initialNotes: [
          makeNote({
            id: "note-3",
            text: "Chase invoice",
            projectId: "proj-1",
            projectName: "Website redesign",
          }),
        ],
      }),
    );

    const link = screen.getByRole("link", { name: /on project: Website redesign/ });
    expect(link).toHaveAttribute("href", "/w/acme/projects/proj-1/list");
  });
});
