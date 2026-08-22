// @vitest-environment jsdom
//
// F173: inline checkbox lists in rich text descriptions
// (components/editor/rich-text-editor.tsx — TaskList/TaskItem extensions,
// their entry in `sanitiseDocument`'s allow-list, and `RichTextRenderer`'s
// `onToggleTaskItem` read-only-toggle wiring).
//
// AS-311: a description checkbox list can be toggled inline. This file
// covers the client-side half — rendering, the sanitisation allow-list,
// the toolbar control, and the click -> onToggleTaskItem contract.
// tests/integration/toggle-description-checklist-item.test.ts covers the
// Server Action half (a real `description_json` update, permission
// checks, persistence across a reload).

import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  RichTextEditor,
  RichTextRenderer,
  sanitiseDocument,
  type JSONContent,
} from "@/components/editor/rich-text-editor";

afterEach(() => {
  cleanup();
});

function checklistDoc(itemId = "item-1", checked = false): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { id: itemId, checked },
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Buy milk" }] },
            ],
          },
        ],
      },
    ],
  };
}

describe("AS-311: a description checkbox list can be toggled inline", () => {
  it("test_AS_311_a_taskList_taskItem_document_renders_as_a_real_checkbox_in_read_only_mode", () => {
    const { container } = render(
      createElement(RichTextRenderer, { content: checklistDoc() }),
    );
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(screen.getByText("Buy milk")).toBeInTheDocument();
    expect((checkbox as HTMLInputElement).checked).toBe(false);
  });

  it("test_AS_311_checked_attribute_true_renders_a_checked_checkbox", () => {
    const { container } = render(
      createElement(RichTextRenderer, { content: checklistDoc("item-1", true) }),
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  });

  it("test_AS_311_clicking_the_checkbox_in_read_only_mode_calls_onToggleTaskItem_with_the_stable_item_id_and_new_checked_value", () => {
    const onToggleTaskItem = vi.fn().mockReturnValue(true);
    const { container } = render(
      createElement(RichTextRenderer, {
        content: checklistDoc("item-42", false),
        onToggleTaskItem,
      }),
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onToggleTaskItem).toHaveBeenCalledTimes(1);
    expect(onToggleTaskItem).toHaveBeenCalledWith("item-42", true);
  });

  it("test_AS_311_clicking_a_checkbox_with_no_persisted_id_is_rejected_and_reverts_without_calling_the_handler", () => {
    // A document stored before this feature shipped ids — no stable
    // handle to address server-side, so the toggle must be rejected
    // rather than silently calling the handler with a bogus id.
    const onToggleTaskItem = vi.fn().mockReturnValue(true);
    const docWithoutId: JSONContent = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "No id" }] },
              ],
            },
          ],
        },
      ],
    };
    const { container } = render(
      createElement(RichTextRenderer, { content: docWithoutId, onToggleTaskItem }),
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onToggleTaskItem).not.toHaveBeenCalled();
    // Reverted: still unchecked, since the toggle was rejected.
    expect(checkbox.checked).toBe(false);
  });

  it("test_AS_311_without_an_onToggleTaskItem_prop_every_click_is_inert_the_checkbox_reverts", () => {
    const { container } = render(
      createElement(RichTextRenderer, { content: checklistDoc("item-1", false) }),
    );
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
  });

  it("test_AS_311_toolbar_has_a_checklist_toggle_button_reflecting_true_editor_state", () => {
    render(
      createElement(RichTextEditor, { content: checklistDoc() }),
    );
    const button = screen.getByRole("button", { name: "Checklist" });
    expect(button).toBeInTheDocument();
    // Cursor lands inside the taskList on mount (it's the only content),
    // so isActive("taskList") should already reflect that real state.
    expect(button).toHaveAttribute("aria-pressed", "true");
  });

  it("test_AS_311_sanitiseDocument_allows_taskList_taskItem_and_only_the_checked_and_id_attrs", () => {
    const hostileDoc = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: {
                id: "item-1",
                checked: true,
                onclick: "alert(1)",
                someOtherField: "should not survive",
              },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Sanitised item" }] },
              ],
            },
          ],
        },
      ],
    } as unknown as JSONContent;

    const sanitised = sanitiseDocument(hostileDoc);
    const taskList = sanitised.content?.[0];
    const taskItem = taskList?.content?.[0];
    expect(taskList?.type).toBe("taskList");
    expect(taskItem?.type).toBe("taskItem");
    expect(taskItem?.attrs).toEqual({ checked: true, id: "item-1" });

    const { container } = render(
      createElement(RichTextRenderer, { content: hostileDoc }),
    );
    expect(container.innerHTML).not.toContain("onclick");
    expect(screen.getByText("Sanitised item")).toBeInTheDocument();
  });

  it("test_AS_311_an_unknown_node_type_inside_a_taskItem_is_still_stripped_by_the_allow_list", () => {
    const hostileDoc = {
      type: "doc",
      content: [
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { id: "item-1", checked: false },
              content: [
                {
                  type: "script",
                  content: [{ type: "text", text: "alert(document.cookie)" }],
                },
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "safe item text" }],
                },
              ],
            },
          ],
        },
      ],
    } as unknown as JSONContent;

    const { container } = render(
      createElement(RichTextRenderer, { content: hostileDoc }),
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.innerHTML).not.toContain("alert(document.cookie)");
    expect(screen.getByText("safe item text")).toBeInTheDocument();
  });
});
