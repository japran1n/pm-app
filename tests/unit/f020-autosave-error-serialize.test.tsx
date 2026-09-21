// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/actions/brief", () => ({
  saveBriefAnswer: vi.fn(),
  submitBrief: vi.fn().mockResolvedValue({ success: true }),
}));

import * as actions from "@/lib/actions/brief";
import { useAutosave } from "@/lib/hooks/use-autosave";
import { PortalQuestionnaire } from "@/components/brief/portal-questionnaire";
import type { BriefQuestion } from "@/lib/queries/brief";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BR-042 autosave failure surfaces", () => {
  it("BR-042: a resolved {success:false} sets error and is not treated as saved", async () => {
    const saveFn = vi.fn().mockResolvedValue({ success: false, error: "nope" });
    const { result, rerender } = renderHook(({ v }) => useAutosave(v, saveFn, 10), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.lastSaved).toBeNull();
  });

  it("BR-042: a rejected save sets error", async () => {
    const saveFn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result, rerender } = renderHook(({ v }) => useAutosave(v, saveFn, 10), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
  });

  it("BR-042: flush with a pending timer issues exactly one write", async () => {
    const saveFn = vi.fn().mockResolvedValue({ success: true });
    const { result, rerender } = renderHook(({ v }) => useAutosave(v, saveFn, 40), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    await act(async () => {
      await result.current.flush();
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(saveFn).toHaveBeenCalledTimes(1);
  });

  it("BR-042: concurrent saves are serialized in order", async () => {
    const log: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const saveFn = vi.fn(async (v: string) => {
      log.push(`start ${v}`);
      if (v === "b") await gate;
      log.push(`end ${v}`);
      return { success: true };
    });
    const { rerender } = renderHook(({ v }) => useAutosave(v, saveFn, 10), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    await waitFor(() => expect(log).toContain("start b"));
    rerender({ v: "c" });
    await new Promise((r) => setTimeout(r, 60));
    expect(log).toEqual(["start b"]);
    release();
    await waitFor(() => expect(log).toContain("end c"));
    expect(log).toEqual(["start b", "end b", "start c", "end c"]);
  });
});

const q: BriefQuestion = {
  id: "q1",
  sectionId: "s1",
  section: "Basics",
  prompt: "Name?",
  helpText: null,
  answerType: "short_text",
  options: null,
  required: true,
  sortOrder: 1,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

describe("BR-042/BR-047 portal indicator and submit gate", () => {
  it("BR-042: failed save shows Couldn't save, not Saved", async () => {
    vi.mocked(actions.saveBriefAnswer).mockResolvedValue({
      success: false,
      error: "db",
    } as never);
    render(
      <PortalQuestionnaire questions={[q]} initialAnswers={[]} briefId="b1" />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    await waitFor(() =>
      expect(screen.getByTestId("questionnaire-autosave-status")).toHaveTextContent(
        "Couldn't save",
      ),
    );
    expect(screen.getByTestId("questionnaire-autosave-status")).not.toHaveTextContent("Saved");
  });

  it("BR-047: Submit is blocked while an answer failed to save", async () => {
    vi.mocked(actions.saveBriefAnswer).mockResolvedValue({
      success: false,
      error: "db",
    } as never);
    render(
      <PortalQuestionnaire questions={[q]} initialAnswers={[]} briefId="b1" />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() =>
      expect(screen.getByTestId("questionnaire-unsaved-warning")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("questionnaire-submit-button")).toBeDisabled();
    expect(actions.submitBrief).not.toHaveBeenCalled();
  });
});
