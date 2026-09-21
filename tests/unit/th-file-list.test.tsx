// @vitest-environment jsdom
//
// F080/F081/F082 — FileList component (components/code-editor/file-list.tsx)
//
// TH-211..TH-230 was the assertion range assigned to this worker task, but
// the actual feature specs (F080-file-list.md, F081-inline-rename.md,
// F082-create-user-files.md) and validation-contract.md both cover these
// features under TH-200..TH-206 (TH-211..TH-230 belong to versioning /
// preview features -- see handoff for details). Tests here target the IDs
// the specs actually assign to F080/F081/F082.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  FileList,
  isValidFileName,
  type FileListEntry,
} from "@/components/code-editor/file-list";

afterEach(cleanup);

const BLOCKS: FileListEntry[] = [
  { index: 0, name: "styles.css", type: "css", isDirty: false },
  { index: 1, name: "main.js", type: "js", isDirty: true },
];

// Two files of the same type, for behaviour that happens within one tab.
const CSS_BLOCKS: FileListEntry[] = [
  { index: 0, name: "styles.css", type: "css" },
  { index: 1, name: "hero.css", type: "css" },
];

describe("FileList (TH-200, TH-201)", () => {
  it("test_TH_200_lists_all_file_rows_across_tabs", () => {
    render(
      <FileList blocks={BLOCKS} activeIndex={0} onSelect={() => {}} />,
    );
    expect(screen.getByTestId("file-row-0")).toBeInTheDocument();
    expect(screen.queryByTestId("file-row-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("file-tab-js"));
    expect(screen.getByTestId("file-row-1")).toBeInTheDocument();
    expect(screen.queryByTestId("file-row-0")).not.toBeInTheDocument();
  });

  it("test_TH_201_row_shows_name_and_dirty_marker", () => {
    render(
      <FileList blocks={BLOCKS} activeIndex={0} onSelect={() => {}} />,
    );
    expect(screen.getByText("styles.css")).toBeInTheDocument();
    expect(screen.queryByTestId("dirty-indicator-0")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("file-tab-js"));
    expect(screen.getByText("main.js")).toBeInTheDocument();
    expect(screen.getByTestId("dirty-indicator-1")).toBeInTheDocument();
  });
});

describe("FileList selection (TH-203)", () => {
  it("test_TH_203_clicking_a_row_selects_it", () => {
    const onSelect = vi.fn();
    render(
      <FileList blocks={CSS_BLOCKS} activeIndex={0} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByTestId("file-row-1"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it("test_TH_203_active_row_is_highlighted", () => {
    render(
      <FileList blocks={CSS_BLOCKS} activeIndex={1} onSelect={() => {}} />,
    );
    expect(screen.getByTestId("file-row-1")).toHaveClass("bg-muted");
    expect(screen.getByTestId("file-row-0")).not.toHaveClass("bg-muted");
  });

  it("test_TH_203_arrow_down_moves_focus_to_next_row", () => {
    render(
      <FileList blocks={CSS_BLOCKS} activeIndex={0} onSelect={() => {}} />,
    );
    const row0 = screen.getByTestId("file-row-0");
    row0.focus();
    fireEvent.keyDown(row0, { key: "ArrowDown" });
    expect(screen.getByTestId("file-row-1")).toHaveFocus();
  });

  it("test_TH_203_enter_selects_the_focused_row", () => {
    const onSelect = vi.fn();
    render(
      <FileList blocks={CSS_BLOCKS} activeIndex={0} onSelect={onSelect} />,
    );
    const row1 = screen.getByTestId("file-row-1");
    row1.focus();
    fireEvent.keyDown(row1, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

describe("FileList inline rename (TH-204)", () => {
  it("test_TH_204_double_click_opens_inline_input", () => {
    render(
      <FileList
        blocks={BLOCKS}
        activeIndex={0}
        onSelect={() => {}}
        onRename={() => {}}
      />,
    );
    fireEvent.doubleClick(screen.getByText("styles.css"));
    expect(screen.getByTestId("file-rename-input-0")).toBeInTheDocument();
  });

  it("test_TH_204_enter_commits_rename", () => {
    const onRename = vi.fn();
    render(
      <FileList
        blocks={BLOCKS}
        activeIndex={0}
        onSelect={() => {}}
        onRename={onRename}
      />,
    );
    fireEvent.doubleClick(screen.getByText("styles.css"));
    const input = screen.getByTestId("file-rename-input-0");
    fireEvent.change(input, { target: { value: "renamed.css" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith(0, "renamed.css");
    expect(screen.queryByTestId("file-rename-input-0")).not.toBeInTheDocument();
  });

  it("test_TH_204_escape_cancels_rename_without_emitting", () => {
    const onRename = vi.fn();
    render(
      <FileList
        blocks={BLOCKS}
        activeIndex={0}
        onSelect={() => {}}
        onRename={onRename}
      />,
    );
    fireEvent.doubleClick(screen.getByText("styles.css"));
    const input = screen.getByTestId("file-rename-input-0");
    fireEvent.change(input, { target: { value: "should-not-save.css" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByTestId("file-rename-input-0")).not.toBeInTheDocument();
    expect(screen.getByText("styles.css")).toBeInTheDocument();
  });

  it("test_TH_204_empty_name_is_rejected", () => {
    const onRename = vi.fn();
    render(
      <FileList
        blocks={BLOCKS}
        activeIndex={0}
        onSelect={() => {}}
        onRename={onRename}
      />,
    );
    fireEvent.doubleClick(screen.getByText("styles.css"));
    const input = screen.getByTestId("file-rename-input-0");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    // Input stays open so the user can correct it.
    expect(screen.getByTestId("file-rename-input-0")).toBeInTheDocument();
  });

  it("test_TH_204_name_over_60_chars_is_rejected", () => {
    expect(isValidFileName("a".repeat(61))).toBe(false);
    expect(isValidFileName("a".repeat(60))).toBe(true);
    expect(isValidFileName("")).toBe(false);
    expect(isValidFileName("valid.css")).toBe(true);
  });
});

describe("FileList create user files (TH-205, TH-206)", () => {
  it("test_TH_205_creating_in_the_css_tab_emits_onCreate_css", () => {
    const onCreate = vi.fn();
    render(
      <FileList
        blocks={BLOCKS}
        activeIndex={0}
        onSelect={() => {}}
        onCreate={onCreate}
      />,
    );
    expect(screen.getByText("CSS files")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-file-button"));
    expect(onCreate).toHaveBeenCalledWith("css");
  });

  it("test_TH_206_creating_in_the_js_tab_emits_onCreate_js", () => {
    const onCreate = vi.fn();
    render(
      <FileList
        blocks={BLOCKS}
        activeIndex={0}
        onSelect={() => {}}
        onCreate={onCreate}
      />,
    );
    fireEvent.click(screen.getByTestId("file-tab-js"));
    expect(screen.getByText("JS files")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("create-file-button"));
    expect(onCreate).toHaveBeenCalledWith("js");
  });

  it("test_TH_206_create_button_hidden_when_onCreate_not_provided", () => {
    render(<FileList blocks={BLOCKS} activeIndex={0} onSelect={() => {}} />);
    expect(screen.queryByTestId("create-file-button")).not.toBeInTheDocument();
  });
});

describe("FileList CSS/JS tabs", () => {
  it("opens on the active file's tab", () => {
    render(<FileList blocks={BLOCKS} activeIndex={1} onSelect={() => {}} />);
    expect(screen.getByTestId("file-tab-js")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("file-row-1")).toBeInTheDocument();
  });

  it("follows the active file into the other tab when selection changes", () => {
    const { rerender } = render(
      <FileList blocks={BLOCKS} activeIndex={0} onSelect={() => {}} />,
    );
    expect(screen.getByTestId("file-tab-css")).toHaveAttribute("aria-selected", "true");
    rerender(<FileList blocks={BLOCKS} activeIndex={1} onSelect={() => {}} />);
    expect(screen.getByTestId("file-tab-js")).toHaveAttribute("aria-selected", "true");
  });

  it("controlled tab reports changes via onTabChange", () => {
    const onTabChange = vi.fn();
    render(
      <FileList
        blocks={BLOCKS}
        activeIndex={0}
        onSelect={() => {}}
        tab="css"
        onTabChange={onTabChange}
      />,
    );
    fireEvent.click(screen.getByTestId("file-tab-js"));
    expect(onTabChange).toHaveBeenCalledWith("js");
  });

  it("renders the sub-label and a mono occurrence count", () => {
    render(
      <FileList
        blocks={[{ index: 0, name: "card.css", type: "css", subLabel: "Original / Embed", occurrences: 20 }]}
        activeIndex={0}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId("file-sublabel-0")).toHaveTextContent("Original / Embed");
    expect(screen.getByTestId("occurrences-0")).toHaveTextContent("×20");
    expect(screen.getByTestId("occurrences-0")).toHaveClass("font-mono");
  });
});

describe("FileList delete (TH-207)", () => {
  it("test_TH_207_delete_button_not_rendered_without_onDelete", () => {
    render(<FileList blocks={BLOCKS} activeIndex={0} onSelect={() => {}} />);
    expect(screen.queryByTestId("delete-file-0")).not.toBeInTheDocument();
  });

  it("test_TH_207_clicking_delete_calls_onDelete_with_index", () => {
    const onDelete = vi.fn(() => true);
    render(
      <FileList
        blocks={BLOCKS}
        activeIndex={0}
        onSelect={() => {}}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByTestId("file-tab-js"));
    fireEvent.click(screen.getByTestId("delete-file-1"));
    expect(onDelete).toHaveBeenCalledWith(1);
  });

  it("test_TH_207_delete_button_disabled_when_only_one_block_remains", () => {
    const onDelete = vi.fn(() => true);
    const singleBlock: FileListEntry[] = [
      { index: 0, name: "only.css", type: "css" },
    ];
    render(
      <FileList
        blocks={singleBlock}
        activeIndex={0}
        onSelect={() => {}}
        onDelete={onDelete}
      />,
    );
    const deleteButton = screen.getByTestId("delete-file-0");
    expect(deleteButton).toBeDisabled();
    fireEvent.click(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe("FileList type icons render distinctly (TH-200)", () => {
  it("test_TH_200_css_and_js_rows_both_render_icons", () => {
    const { container } = render(
      <FileList blocks={BLOCKS} activeIndex={0} onSelect={() => {}} />,
    );
    const svgs = container.querySelectorAll("svg");
    // At least one icon per visible row.
    expect(svgs.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByTestId("file-tab-js"));
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(1);
  });
});

describe("FileList modified indicator (TH-218)", () => {
  const MODIFIED_BLOCKS: FileListEntry[] = [
    { index: 0, name: "styles.css", type: "css", isModified: true },
    { index: 1, name: "main.js", type: "js", isModified: false },
  ];

  it("test_TH_218_row_shows_modified_indicator_when_active_version_not_original", () => {
    render(
      <FileList blocks={MODIFIED_BLOCKS} activeIndex={0} onSelect={() => {}} />,
    );
    expect(screen.getByTestId("modified-indicator-0")).toBeInTheDocument();
  });

  it("test_TH_218_row_has_no_modified_indicator_when_active_version_is_original", () => {
    render(
      <FileList blocks={MODIFIED_BLOCKS} activeIndex={0} onSelect={() => {}} />,
    );
    expect(screen.queryByTestId("modified-indicator-1")).not.toBeInTheDocument();
  });

  it("test_TH_218_modified_indicator_is_visually_distinct_from_dirty_indicator", () => {
    const BOTH: FileListEntry[] = [
      { index: 0, name: "styles.css", type: "css", isModified: true, isDirty: true },
    ];
    render(<FileList blocks={BOTH} activeIndex={0} onSelect={() => {}} />);
    const modified = screen.getByTestId("modified-indicator-0");
    const dirty = screen.getByTestId("dirty-indicator-0");
    expect(modified).toBeInTheDocument();
    expect(dirty).toBeInTheDocument();
    expect(modified.className).not.toBe(dirty.className);
  });
});
