// @vitest-environment jsdom
//
// F161: real DOM render tests for AS-287 ("all assignees appear as a
// stacked avatar group on the card") and AS-288 ("overflow beyond the
// display limit shows a count"). Renders the actual
// components/user-avatar-group.tsx component (not source-text grep) and
// asserts real avatar nodes / overflow chip / tooltip content appear in
// the DOM — same convention as tests/unit/user-avatar.test.tsx.

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  UserAvatarGroup,
  AVATAR_GROUP_LIMIT,
} from "@/components/user-avatar-group";
import type { UserAvatarPerson } from "@/components/user-avatar";
import { TaskCard, type TaskCardTask } from "@/components/task/task-card";

afterEach(() => {
  cleanup();
});

function person(id: string, name: string): UserAvatarPerson {
  return { id, name, email: null };
}

const FIVE_PEOPLE: UserAvatarPerson[] = [
  person("11111111-1111-4111-8111-111111111111", "Ada Lovelace"),
  person("22222222-2222-4222-8222-222222222222", "Grace Hopper"),
  person("33333333-3333-4333-8333-333333333333", "Katherine Johnson"),
  person("44444444-4444-4444-8444-444444444444", "Margaret Hamilton"),
  person("55555555-5555-4555-8555-555555555555", "Hedy Lamarr"),
];

describe("test_AS_287_all_assignees_appear_as_a_stacked_avatar_group", () => {
  it("renders one avatar node per assignee, up to the display limit, inside the group", () => {
    const three = FIVE_PEOPLE.slice(0, 3);
    render(createElement(UserAvatarGroup, { people: three }));
    const group = screen.getByTestId("avatar-group");
    expect(group).toBeInTheDocument();
    for (const p of three) {
      expect(screen.getByRole("img", { name: p.name! })).toBeInTheDocument();
    }
  });

  it("the group's accessible label names every assignee, not just the visible ones", () => {
    render(createElement(UserAvatarGroup, { people: FIVE_PEOPLE }));
    const group = screen.getByTestId("avatar-group");
    for (const p of FIVE_PEOPLE) {
      expect(group.getAttribute("aria-label")).toContain(p.name);
    }
  });

  it("renders nothing for a task with no assignees (empty state)", () => {
    const { container } = render(createElement(UserAvatarGroup, { people: [] }));
    expect(container).toBeEmptyDOMElement();
  });

  it("a task card with multiple assignees renders every visible avatar via the real TaskCard component", () => {
    const three = FIVE_PEOPLE.slice(0, 3);
    const task: TaskCardTask = {
      id: "task-1",
      title: "Ship the thing",
      status: "todo",
      priority: "medium",
      assigneeId: three[0]!.id,
      assigneeIds: three.map((p) => p.id),
      dueDate: null,
      position: 1,
    };
    render(createElement(TaskCard, { task, assignees: three, timezone: "UTC" }));
    for (const p of three) {
      expect(screen.getByRole("img", { name: p.name! })).toBeInTheDocument();
    }
  });
});

describe("test_AS_288_overflow_beyond_display_limit_shows_a_count", () => {
  it("shows a +K overflow chip when assignees exceed the display limit", () => {
    render(createElement(UserAvatarGroup, { people: FIVE_PEOPLE }));
    const overflowCount = FIVE_PEOPLE.length - AVATAR_GROUP_LIMIT;
    const chip = screen.getByTestId("avatar-group-overflow");
    expect(chip).toHaveTextContent(`+${overflowCount}`);
  });

  it("renders exactly `max` avatar nodes, never more, once overflow is showing", () => {
    render(createElement(UserAvatarGroup, { people: FIVE_PEOPLE, max: 2 }));
    const group = screen.getByTestId("avatar-group");
    const avatarNodes = group.querySelectorAll('[data-slot="avatar"]');
    expect(avatarNodes.length).toBe(2);
    expect(screen.getByTestId("avatar-group-overflow")).toHaveTextContent("+3");
  });

  it("no overflow chip renders when the assignee count is within the display limit", () => {
    render(createElement(UserAvatarGroup, { people: FIVE_PEOPLE.slice(0, 2) }));
    expect(screen.queryByTestId("avatar-group-overflow")).not.toBeInTheDocument();
  });

  it("the overflow chip's accessible label names every hidden assignee, not just the count", () => {
    render(createElement(UserAvatarGroup, { people: FIVE_PEOPLE }));
    const chip = screen.getByTestId("avatar-group-overflow");
    const hidden = FIVE_PEOPLE.slice(AVATAR_GROUP_LIMIT);
    for (const p of hidden) {
      expect(chip.getAttribute("aria-label")).toContain(p.name);
    }
  });

  it("the overflow chip is a real focusable button, not a hover-only element (keyboard reachability)", () => {
    render(createElement(UserAvatarGroup, { people: FIVE_PEOPLE }));
    const chip = screen.getByTestId("avatar-group-overflow");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).not.toHaveAttribute("disabled");
  });
});
