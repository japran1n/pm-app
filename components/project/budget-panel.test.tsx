// @vitest-environment jsdom
//
// Paket B (client-portal redesign, `projects.billing_model`): the PM-facing
// toggle on the Budget settings panel that flips a project between
// `hourly` and `fixed_price`, gating the client portal's Hours view (see
// components/portal/portal-sidebar.tsx and the portal /hours route's own
// guard). This only covers the toggle itself -- the rest of BudgetPanel's
// CRUD behaviour predates this feature and is untouched.

import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { toastErrorMock, toastSuccessMock, updateBillingModelMock } = vi.hoisted(() => ({
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  updateBillingModelMock: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock("@/lib/actions/project-budgets", () => ({
  createProjectBudget: vi.fn(),
  deleteProjectBudget: vi.fn(),
  previewProjectBudgetSpent: vi.fn(),
  restoreProjectBudget: vi.fn(),
  updateProjectBudget: vi.fn(),
  updateProjectBillingModel: updateBillingModelMock,
}));

import { BudgetPanel } from "./budget-panel";

afterEach(() => {
  cleanup();
  toastErrorMock.mockReset();
  toastSuccessMock.mockReset();
  updateBillingModelMock.mockReset();
});

describe("BudgetPanel billing model toggle (Paket B)", () => {
  it("shows fixed_price as the selected value when the project is fixed_price", () => {
    render(
      createElement(BudgetPanel, {
        projectId: "project-1",
        initialBudgets: [],
        billingModel: "fixed_price",
        canManage: true,
      }),
    );

    const select = screen.getByTestId("billing-model-select");
    expect(select).toHaveTextContent("fixed_price");
  });

  it("shows hourly as the selected value when the project is hourly", () => {
    render(
      createElement(BudgetPanel, {
        projectId: "project-1",
        initialBudgets: [],
        billingModel: "hourly",
        canManage: true,
      }),
    );

    const select = screen.getByTestId("billing-model-select");
    expect(select).toHaveTextContent("hourly");
  });

  it("disables the toggle for a caller without manage permission", () => {
    render(
      createElement(BudgetPanel, {
        projectId: "project-1",
        initialBudgets: [],
        billingModel: "fixed_price",
        canManage: false,
      }),
    );

    expect(screen.getByTestId("billing-model-select")).toHaveAttribute("data-disabled");
  });

  it("calls updateProjectBillingModel with the new value and shows a success toast", async () => {
    updateBillingModelMock.mockResolvedValue({ ok: true, data: { billingModel: "hourly" } });

    render(
      createElement(BudgetPanel, {
        projectId: "project-1",
        initialBudgets: [],
        billingModel: "fixed_price",
        canManage: true,
      }),
    );

    fireEvent.click(screen.getByTestId("billing-model-select"));
    const option = screen.getByRole("option", { name: /Hourly/ });
    // base-ui's Select only commits a click-driven selection when the
    // click is preceded by a pointerdown on the same option -- see
    // components/portal/pages-table.test.tsx's own comment on this gate.
    fireEvent.pointerDown(option);
    await act(async () => {
      fireEvent.click(option);
    });

    expect(updateBillingModelMock).toHaveBeenCalledWith({
      projectId: "project-1",
      billingModel: "hourly",
    });
    expect(toastSuccessMock).toHaveBeenCalled();
  });

  it("shows an error toast and keeps the prior value when the update fails", async () => {
    updateBillingModelMock.mockResolvedValue({ ok: false, error: "Something went wrong." });

    render(
      createElement(BudgetPanel, {
        projectId: "project-1",
        initialBudgets: [],
        billingModel: "fixed_price",
        canManage: true,
      }),
    );

    fireEvent.click(screen.getByTestId("billing-model-select"));
    const option = screen.getByRole("option", { name: /Hourly/ });
    // base-ui's Select only commits a click-driven selection when the
    // click is preceded by a pointerdown on the same option -- see
    // components/portal/pages-table.test.tsx's own comment on this gate.
    fireEvent.pointerDown(option);
    await act(async () => {
      fireEvent.click(option);
    });

    expect(toastErrorMock).toHaveBeenCalledWith("Something went wrong.");
    expect(screen.getByTestId("billing-model-select")).toHaveTextContent("fixed_price");
  });
});
