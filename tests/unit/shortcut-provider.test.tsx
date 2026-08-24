// @vitest-environment jsdom
//
// F244 (AS-467, AS-468, AS-470, AS-471): global keyboard shortcuts.

import { createElement } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

let currentPathname = "/w/acme/projects/proj-1/board";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPathname,
}));

import { ShortcutProvider } from "@/components/command/shortcut-provider";
import {
  isEditableTarget,
  pushEscapeLayer,
  popTopEscapeLayer,
  __resetEscapeLayersForTests,
  SHORTCUT_EVENTS,
} from "@/lib/hooks/use-shortcut";

afterEach(() => {
  cleanup();
  __resetEscapeLayersForTests();
});

beforeEach(() => {
  currentPathname = "/w/acme/projects/proj-1/board";
});

function fireKey(key: string, init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(document, { key, ...init });
}

describe("isEditableTarget (AS-470 guard)", () => {
  it("test_AS_470_input_and_textarea_are_editable", () => {
    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(textarea)).toBe(true);
  });

  it("test_AS_470_contenteditable_is_editable", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    document.body.appendChild(div);
    expect(isEditableTarget(div)).toBe(true);
    div.remove();
  });

  it("test_AS_470_tiptap_prosemirror_root_is_editable", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "ProseMirror";
    const child = document.createElement("p");
    wrapper.appendChild(child);
    document.body.appendChild(wrapper);
    expect(isEditableTarget(child)).toBe(true);
    wrapper.remove();
  });

  it("test_AS_470_plain_div_is_not_editable", () => {
    const div = document.createElement("div");
    expect(isEditableTarget(div)).toBe(false);
  });
});

describe("ShortcutProvider n/slash single-key shortcuts", () => {
  it("test_AS_467_n_dispatches_new_task_with_current_project_context", () => {
    render(createElement(ShortcutProvider));
    const handler = vi.fn();
    window.addEventListener(SHORTCUT_EVENTS.newTask, handler);

    fireKey("n");

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ projectId: "proj-1" });

    window.removeEventListener(SHORTCUT_EVENTS.newTask, handler);
  });

  it("test_AS_467_n_is_a_no_op_outside_a_project_context", () => {
    currentPathname = "/w/acme/settings/members";
    render(createElement(ShortcutProvider));
    const handler = vi.fn();
    window.addEventListener(SHORTCUT_EVENTS.newTask, handler);

    fireKey("n");

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(SHORTCUT_EVENTS.newTask, handler);
  });

  it("test_AS_468_slash_dispatches_open_search", () => {
    render(createElement(ShortcutProvider));
    const handler = vi.fn();
    window.addEventListener(SHORTCUT_EVENTS.openSearch, handler);

    fireKey("/");

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(SHORTCUT_EVENTS.openSearch, handler);
  });

  it("test_AS_470_n_does_not_fire_while_typing_in_an_input", () => {
    render(createElement(ShortcutProvider));
    const handler = vi.fn();
    window.addEventListener(SHORTCUT_EVENTS.newTask, handler);

    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "n" });

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(SHORTCUT_EVENTS.newTask, handler);
    input.remove();
  });

  it("test_AS_470_slash_does_not_fire_while_typing_in_a_contenteditable_editor", () => {
    render(createElement(ShortcutProvider));
    const handler = vi.fn();
    window.addEventListener(SHORTCUT_EVENTS.openSearch, handler);

    const editor = document.createElement("div");
    editor.className = "ProseMirror";
    editor.setAttribute("contenteditable", "true");
    document.body.appendChild(editor);
    fireEvent.keyDown(editor, { key: "/" });

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(SHORTCUT_EVENTS.openSearch, handler);
    editor.remove();
  });

  it("test_AS_467_key_repeat_does_not_re_fire_the_shortcut", () => {
    render(createElement(ShortcutProvider));
    const handler = vi.fn();
    window.addEventListener(SHORTCUT_EVENTS.newTask, handler);

    fireEvent.keyDown(document, { key: "n", repeat: true });

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(SHORTCUT_EVENTS.newTask, handler);
  });

  it("test_AS_467_modified_n_does_not_fire_the_bare_shortcut", () => {
    render(createElement(ShortcutProvider));
    const handler = vi.fn();
    window.addEventListener(SHORTCUT_EVENTS.newTask, handler);

    fireEvent.keyDown(document, { key: "n", metaKey: true });

    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener(SHORTCUT_EVENTS.newTask, handler);
  });

  it("coexists with a separate Cmd+K-style listener without double-firing either shortcut", () => {
    render(createElement(ShortcutProvider));

    const cmdKHandler = vi.fn();
    function competingListener(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        cmdKHandler();
      }
    }
    document.addEventListener("keydown", competingListener);

    const newTaskHandler = vi.fn();
    window.addEventListener(SHORTCUT_EVENTS.newTask, newTaskHandler);

    fireEvent.keyDown(document, { key: "k", metaKey: true });
    expect(cmdKHandler).toHaveBeenCalledTimes(1);
    expect(newTaskHandler).not.toHaveBeenCalled();

    fireKey("n");
    expect(newTaskHandler).toHaveBeenCalledTimes(1);
    expect(cmdKHandler).toHaveBeenCalledTimes(1);

    document.removeEventListener("keydown", competingListener);
    window.removeEventListener(SHORTCUT_EVENTS.newTask, newTaskHandler);
  });
});

describe("Escape layer stack (AS-471)", () => {
  it("test_AS_471_escape_closes_only_the_topmost_layer", () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    pushEscapeLayer(closeFirst);
    pushEscapeLayer(closeSecond);

    const handled = popTopEscapeLayer();

    expect(handled).toBe(true);
    expect(closeSecond).toHaveBeenCalledTimes(1);
    expect(closeFirst).not.toHaveBeenCalled();
  });

  it("test_AS_471_escape_closes_layers_one_at_a_time_not_all_at_once", () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    pushEscapeLayer(closeFirst);
    pushEscapeLayer(closeSecond);

    popTopEscapeLayer();
    expect(closeFirst).not.toHaveBeenCalled();

    popTopEscapeLayer();
    expect(closeFirst).toHaveBeenCalledTimes(1);
  });

  it("test_AS_471_escape_with_no_open_layers_is_a_reported_no_op", () => {
    expect(popTopEscapeLayer()).toBe(false);
  });

  it("test_AS_471_provider_pops_topmost_layer_on_escape_keydown", () => {
    const close = vi.fn();
    pushEscapeLayer(close);
    render(createElement(ShortcutProvider));

    fireKey("Escape");

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("test_AS_471_a_popped_layer_removes_itself_via_its_own_unregister_function", () => {
    const close = vi.fn();
    const unregister = pushEscapeLayer(close);
    unregister();

    expect(popTopEscapeLayer()).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });
});

describe("ShortcutProvider StrictMode mount/unmount safety", () => {
  it("test_AS_467_strictmode_double_mount_leaves_exactly_one_listener_active", () => {
    // Simulate React StrictMode's dev-only mount -> cleanup -> mount
    // replay by rendering, unmounting, and rendering again, then
    // asserting the shortcut only fires ONCE per keystroke afterward —
    // a stale duplicate listener from the first mount would double-fire
    // it (the exact class of bug the F329 regression was).
    const first = render(createElement(ShortcutProvider));
    first.unmount();
    render(createElement(ShortcutProvider));

    const handler = vi.fn();
    window.addEventListener(SHORTCUT_EVENTS.newTask, handler);

    fireKey("n");

    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener(SHORTCUT_EVENTS.newTask, handler);
  });
});
