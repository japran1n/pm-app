// @vitest-environment jsdom
//
// F092 (TH-260) — editor preferences stored independently of per-host state.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_EDITOR_PREFS,
  loadEditorPrefs,
  saveEditorPrefs,
} from "@/lib/code-editor/editor-prefs";

// jsdom in this repo's node --localstorage-file-less configuration has no
// window.localStorage. A minimal in-memory polyfill only, scoped to this
// test file (mirrors the pattern used by palette-actions-recents.test.tsx).
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("F092 editor preferences", () => {
  it("TH-260: loadEditorPrefs returns defaults when nothing is stored", () => {
    expect(loadEditorPrefs()).toEqual(DEFAULT_EDITOR_PREFS);
  });

  it("TH-260: saveEditorPrefs persists under the ce-prefs-v1 key", () => {
    saveEditorPrefs({ fontSize: 18 });
    const raw = window.localStorage.getItem("ce-prefs-v1");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toMatchObject({ fontSize: 18 });
  });

  it("TH-260: saveEditorPrefs merges partial updates with existing prefs", () => {
    saveEditorPrefs({ fontSize: 20 });
    saveEditorPrefs({ wordWrap: "off" });
    const prefs = loadEditorPrefs();
    expect(prefs.fontSize).toBe(20);
    expect(prefs.wordWrap).toBe("off");
    expect(prefs.minimap).toBe(DEFAULT_EDITOR_PREFS.minimap);
  });

  it("TH-260: preferences persist independently of any host's files (separate key)", () => {
    // Simulate a host's per-site state living under a different key, then
    // clearing it, and confirm editor prefs are untouched.
    window.localStorage.setItem("ce-host-example.com", JSON.stringify({ blocks: [1, 2, 3] }));
    saveEditorPrefs({ theme: "vs" });
    window.localStorage.removeItem("ce-host-example.com");
    expect(loadEditorPrefs().theme).toBe("vs");
  });

  it("falls back to defaults on malformed JSON without throwing", () => {
    window.localStorage.setItem("ce-prefs-v1", "{not json");
    expect(() => loadEditorPrefs()).not.toThrow();
    expect(loadEditorPrefs()).toEqual(DEFAULT_EDITOR_PREFS);
  });

  it("falls back to defaults for invalid field values", () => {
    window.localStorage.setItem(
      "ce-prefs-v1",
      JSON.stringify({ fontSize: "big", wordWrap: "maybe", minimap: "yes", theme: "dracula" }),
    );
    expect(loadEditorPrefs()).toEqual(DEFAULT_EDITOR_PREFS);
  });

  it("does not throw when localStorage.setItem fails (e.g. quota exceeded)", () => {
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveEditorPrefs({ fontSize: 22 })).not.toThrow();
    spy.mockRestore();
  });
});
