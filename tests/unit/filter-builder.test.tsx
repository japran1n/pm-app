// @vitest-environment jsdom
//
// Follow-up (nested AND/OR groups -> UI): <FilterBuilder> lets a user add
// a condition, switch its operator to "is any of" (multi-select), tick
// several values, remove a condition, and now also add/remove NESTED
// groups with their own AND/OR combinator toggle. Also proves backward
// compatibility: an existing single-value "eq" filter (the pre-existing
// flat saved-view shape), lifted through `normalizeFilterGroup` into a
// trivial top-level "and" group, renders as a plain single-select
// condition, not an error.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { FilterBuilder } from "@/components/views/filter-builder";
import { normalizeFilterGroup, type FilterGroup } from "@/lib/validation/views";

afterEach(cleanup);

const fieldOptions = [
  {
    field: "status" as const,
    label: "Status",
    values: [
      { value: "todo", label: "To Do" },
      { value: "in_progress", label: "In Progress" },
      { value: "done", label: "Done" },
    ],
  },
  {
    field: "priority" as const,
    label: "Priority",
    values: [
      { value: "high", label: "High" },
      { value: "low", label: "Low" },
    ],
  },
  {
    field: "assigneeId" as const,
    label: "Assignee",
    values: [{ value: "user-1", label: "Alice" }],
  },
];

describe("FilterBuilder", () => {
  it("test_an_existing_single_value_eq_filter_renders_as_a_single_select_condition_backward_compat", () => {
    const group = normalizeFilterGroup([{ field: "status", operator: "eq", value: "todo" }]);
    render(<FilterBuilder filterGroup={group} onChange={vi.fn()} fieldOptions={fieldOptions} />);

    expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("test_switching_a_condition_to_is_any_of_shows_a_multi_select_checkbox_list", () => {
    const onChange = vi.fn();
    const group: FilterGroup = {
      combinator: "and",
      conditions: [{ field: "status", operator: "in", value: ["todo"] }],
    };
    render(<FilterBuilder filterGroup={group} onChange={onChange} fieldOptions={fieldOptions} />);

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(3);
    expect(checkboxes[0]).toHaveAttribute("data-checked");
  });

  it("test_ticking_a_second_value_in_an_is_any_of_condition_adds_it_to_the_arrays_value", () => {
    const onChange = vi.fn();
    const group: FilterGroup = {
      combinator: "and",
      conditions: [{ field: "status", operator: "in", value: ["todo"] }],
    };
    render(<FilterBuilder filterGroup={group} onChange={onChange} fieldOptions={fieldOptions} />);

    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]); // "in_progress"

    expect(onChange).toHaveBeenCalledWith({
      combinator: "and",
      conditions: [{ field: "status", operator: "in", value: ["todo", "in_progress"] }],
    });
  });

  it("test_adding_a_condition_appends_one_using_the_first_available_field_and_value", () => {
    const onChange = vi.fn();
    const group: FilterGroup = { combinator: "and", conditions: [] };
    render(<FilterBuilder filterGroup={group} onChange={onChange} fieldOptions={fieldOptions} />);

    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));

    expect(onChange).toHaveBeenCalledWith({
      combinator: "and",
      conditions: [{ field: "status", operator: "eq", value: "todo" }],
    });
  });

  it("test_removing_a_condition_drops_it_from_the_array", () => {
    const onChange = vi.fn();
    const group: FilterGroup = {
      combinator: "and",
      conditions: [
        { field: "status", operator: "eq", value: "todo" },
        { field: "priority", operator: "eq", value: "high" },
      ],
    };
    render(<FilterBuilder filterGroup={group} onChange={onChange} fieldOptions={fieldOptions} />);

    const removeButtons = screen.getAllByRole("button", { name: "Remove condition" });
    fireEvent.click(removeButtons[0]);

    expect(onChange).toHaveBeenCalledWith({
      combinator: "and",
      conditions: [{ field: "priority", operator: "eq", value: "high" }],
    });
  });

  it("test_add_group_appends_a_nested_empty_and_group", () => {
    const onChange = vi.fn();
    const group: FilterGroup = { combinator: "and", conditions: [] };
    render(<FilterBuilder filterGroup={group} onChange={onChange} fieldOptions={fieldOptions} />);

    fireEvent.click(screen.getByRole("button", { name: "Add group" }));

    expect(onChange).toHaveBeenCalledWith({
      combinator: "and",
      conditions: [{ combinator: "and", conditions: [] }],
    });
  });

  it("test_a_nested_group_renders_with_its_own_remove_group_button_and_removing_it_drops_only_that_group", () => {
    const onChange = vi.fn();
    const group: FilterGroup = {
      combinator: "or",
      conditions: [
        { field: "status", operator: "eq", value: "todo" },
        { combinator: "and", conditions: [{ field: "priority", operator: "eq", value: "high" }] },
      ],
    };
    render(<FilterBuilder filterGroup={group} onChange={onChange} fieldOptions={fieldOptions} />);

    const removeGroupButtons = screen.getAllByRole("button", { name: "Remove group" });
    expect(removeGroupButtons.length).toBe(1);
    fireEvent.click(removeGroupButtons[0]);

    expect(onChange).toHaveBeenCalledWith({
      combinator: "or",
      conditions: [{ field: "status", operator: "eq", value: "todo" }],
    });
  });

  it("test_nested_groups_render_at_least_two_levels_deep", () => {
    const group: FilterGroup = {
      combinator: "and",
      conditions: [
        {
          combinator: "or",
          conditions: [{ field: "status", operator: "eq", value: "todo" }],
        },
      ],
    };
    render(<FilterBuilder filterGroup={group} onChange={vi.fn()} fieldOptions={fieldOptions} />);

    const groups = screen.getAllByTestId("filter-group");
    expect(groups.length).toBe(2);
    expect(groups[1]).toHaveAttribute("data-depth", "1");
  });
});
