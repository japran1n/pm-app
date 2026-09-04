// Render test for F083: "which of my tasks is the client watching" and
// "which are blocked on the client" should be answerable without opening
// every task — TaskCard now renders a client-visible indicator and a
// distinct awaiting-client chip, icon+text (never colour alone), same
// convention as the existing blocked/over-estimate indicators (see
// tests/unit/task-card-blocked-indicator-render.test.ts's own header for
// what this renderToStaticMarkup style can/can't prove).

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { TaskCard, type TaskCardTask } from "@/components/task/task-card";

const BASE_TASK: TaskCardTask = {
  id: "task-1",
  title: "Ship the release",
  status: "todo",
  priority: null,
  assigneeId: null,
  dueDate: null,
  position: 1000,
};

describe("TaskCard renders client-visibility/awaiting-client indicators (F083)", () => {
  it("shows an icon+text 'Client-visible' indicator when clientVisible is true", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, clientVisible: true },
        timezone: "UTC",
      }),
    );

    expect(html).toContain("Client-visible");
    expect(html).toContain("lucide-eye");
  });

  it("shows no client-visible indicator when clientVisible is false/undefined", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, { task: BASE_TASK, timezone: "UTC" }),
    );

    expect(html).not.toContain("Client-visible");
  });

  it("shows a distinct icon+text 'Awaiting client' chip when pendingClientApproval is true", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, pendingClientApproval: true },
        timezone: "UTC",
      }),
    );

    expect(html).toContain("Awaiting client");
    expect(html).toContain("lucide-circle-dot");
  });

  it("shows no awaiting-client chip when pendingClientApproval is false/undefined", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, { task: BASE_TASK, timezone: "UTC" }),
    );

    expect(html).not.toContain("Awaiting client");
  });

  it("renders both indicators independently when both flags are true", () => {
    const html = renderToStaticMarkup(
      createElement(TaskCard, {
        task: { ...BASE_TASK, clientVisible: true, pendingClientApproval: true },
        timezone: "UTC",
      }),
    );

    expect(html).toContain("Client-visible");
    expect(html).toContain("Awaiting client");
  });
});
