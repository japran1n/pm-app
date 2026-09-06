// @vitest-environment jsdom
//
// F107 (missions/20260903-portal, docs/client-portal-visual-plan.md 2.2):
// items rendering their name, age and inline action.
//
// F115 round 2 (coordinator review): this block used to also cover its
// own "nothing waiting on you" empty-state copy -- removed because it
// duplicated the launch headline's own case-4 sentence one screen-height
// above it (see waiting-on-you-block.tsx's own header). The empty case
// is now "renders nothing", covered below.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { WaitingOnYouBlock } from "@/components/portal/waiting-on-you-block";

afterEach(() => {
  cleanup();
});

describe("WaitingOnYouBlock", () => {
  it("test_waiting_on_you_empty_case_renders_nothing_rather_than_a_duplicate_sentence", () => {
    const { container } = render(<WaitingOnYouBlock items={[]} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("waiting-on-you-block")).not.toBeInTheDocument();
  });

  it("test_waiting_on_you_renders_named_items_with_age_and_inline_action", () => {
    render(
      <WaitingOnYouBlock
        items={[
          {
            key: "task:task-1",
            kind: "task",
            title: "Homepage hero copy",
            href: "/portal/acme/p/project-1/t/task-1",
            daysWaiting: 3,
            actionLabel: "Review",
          },
          {
            key: "deliverable:d-1",
            kind: "deliverable",
            title: "Logo files",
            href: "/portal/acme/p/project-1/your-list",
            daysWaiting: 5,
            actionLabel: "Open",
          },
        ]}
      />,
    );

    const taskItem = screen.getByTestId("waiting-on-you-item-task:task-1");
    expect(taskItem).toHaveTextContent("Homepage hero copy");
    expect(taskItem).toHaveTextContent("3 days waiting");
    expect(taskItem).toHaveTextContent("Review");
    expect(taskItem).toHaveAttribute("href", "/portal/acme/p/project-1/t/task-1");

    const deliverableItem = screen.getByTestId("waiting-on-you-item-deliverable:d-1");
    expect(deliverableItem).toHaveTextContent("Logo files");
    expect(deliverableItem).toHaveTextContent("5 days overdue");
    expect(deliverableItem).toHaveTextContent("Open");
  });

  // F107 round 2 (coordinator review): a shared icon across all three
  // kinds made an approval, a task and a deliverable indistinguishable
  // at a glance -- each kind now renders its own icon (checked here by
  // the actual SVG each lucide icon emits, not just by kind label text,
  // since the row's own title/action text was never in question).
  it("test_waiting_on_you_gives_each_item_kind_its_own_icon", () => {
    render(
      <WaitingOnYouBlock
        items={[
          {
            key: "approval:a-1",
            kind: "approval",
            title: "Approve style guide",
            href: "/portal/acme/p/project-1/approvals",
            daysWaiting: 2,
            actionLabel: "Review",
          },
          {
            key: "task:task-1",
            kind: "task",
            title: "Homepage hero copy",
            href: "/portal/acme/p/project-1/t/task-1",
            daysWaiting: 3,
            actionLabel: "Review",
          },
          {
            key: "deliverable:d-1",
            kind: "deliverable",
            title: "Logo files",
            href: "/portal/acme/p/project-1/your-list",
            daysWaiting: 5,
            actionLabel: "Open",
          },
        ]}
      />,
    );

    const approvalIcon = screen
      .getByTestId("waiting-on-you-item-approval:a-1")
      .querySelector("svg")!;
    const taskIcon = screen
      .getByTestId("waiting-on-you-item-task:task-1")
      .querySelector("svg")!;
    const deliverableIcon = screen
      .getByTestId("waiting-on-you-item-deliverable:d-1")
      .querySelector("svg")!;

    expect(approvalIcon.outerHTML).not.toEqual(taskIcon.outerHTML);
    expect(taskIcon.outerHTML).not.toEqual(deliverableIcon.outerHTML);
    expect(approvalIcon.outerHTML).not.toEqual(deliverableIcon.outerHTML);
  });

  it("test_waiting_on_you_renders_an_account_item_with_its_own_icon_and_action_label", () => {
    render(
      <WaitingOnYouBlock
        items={[
          {
            key: "account:account-1",
            kind: "account",
            title: "Domain registrar",
            href: "/portal/acme/p/project-1/site",
            daysWaiting: 0,
            actionLabel: "Provide access",
          },
          {
            key: "task:task-1",
            kind: "task",
            title: "Homepage hero copy",
            href: "/portal/acme/p/project-1/t/task-1",
            daysWaiting: 3,
            actionLabel: "Review",
          },
        ]}
      />,
    );

    const accountItem = screen.getByTestId("waiting-on-you-item-account:account-1");
    expect(accountItem).toHaveTextContent("Domain registrar");
    expect(accountItem).toHaveTextContent("Needs access");
    expect(accountItem).toHaveTextContent("Provide access");
    expect(accountItem).toHaveAttribute("href", "/portal/acme/p/project-1/site");

    const accountIcon = accountItem.querySelector("svg")!;
    const taskIcon = screen
      .getByTestId("waiting-on-you-item-task:task-1")
      .querySelector("svg")!;
    expect(accountIcon.outerHTML).not.toEqual(taskIcon.outerHTML);
  });
});
