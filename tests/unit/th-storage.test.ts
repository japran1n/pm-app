// @vitest-environment jsdom
//
// F089 (TH-250..TH-255), F090 (TH-256, TH-257), F091 (TH-258, TH-259) —
// per-host localStorage persistence for the code editor tool.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearEditorState,
  getStorageKey,
  loadEditorState,
  saveEditorState,
  StorageQuotaError,
  type EditorState,
} from "@/lib/webflow-editor/storage";

// Node 26 + jsdom 30 only expose a global `localStorage` when the process
// is launched with `--localstorage-file`, which the test runner does not
// set, so `window.localStorage` comes back `undefined` in this jsdom
// environment. This is an environment gap pre-dating this feature (the
// same failure mode hits tests/unit/th-editor-prefs.test.ts). Install a
// minimal in-memory `Storage` polyfill so this file's tests exercise the
// real code paths in lib/webflow-editor/storage.ts (which itself already
// guards every call site against `localStorage` being unavailable).
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

if (typeof window !== "undefined" && !window.localStorage) {
  Object.defineProperty(window, "localStorage", {
    value: new MemoryStorage(),
    writable: true,
    configurable: true,
  });
}

function makeState(overrides: Partial<EditorState> = {}): EditorState {
  return {
    blocks: [
      {
        id: "block-1",
        index: 0,
        type: "style",
        name: "styles.css",
        activeVersionId: "v-original",
      },
    ],
    versions: {
      "block-1": [
        {
          id: "v-original",
          name: "Original",
          content: ".foo { color: red; }",
          readOnly: true,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    selectedBlockId: "block-1",
    url: "https://example.webflow.io",
    ...overrides,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("F089 per-host storage", () => {
  it("TH-250/key format: getStorageKey returns ce-v1:{hostname}", () => {
    expect(getStorageKey("example.webflow.io")).toBe("ce-v1:example.webflow.io");
    expect(getStorageKey("other-site.webflow.io")).toBe("ce-v1:other-site.webflow.io");
  });

  it("TH-251/save: saveEditorState persists to localStorage under the host key", () => {
    const state = makeState();
    saveEditorState("example.webflow.io", state);

    const raw = window.localStorage.getItem("ce-v1:example.webflow.io");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string)).toEqual(state);
  });

  it("TH-252/load: loadEditorState retrieves what was persisted", () => {
    const state = makeState();
    saveEditorState("example.webflow.io", state);

    const loaded = loadEditorState("example.webflow.io");
    expect(loaded).toEqual(state);
  });

  it("TH-253/clear: clearEditorState removes the host's key", () => {
    saveEditorState("example.webflow.io", makeState());
    expect(window.localStorage.getItem("ce-v1:example.webflow.io")).toBeTruthy();

    clearEditorState("example.webflow.io");
    expect(window.localStorage.getItem("ce-v1:example.webflow.io")).toBeNull();
  });

  it("TH-254/missing: loadEditorState returns null when nothing is stored", () => {
    expect(loadEditorState("never-loaded.webflow.io")).toBeNull();
  });

  it("TH-255/malformed json: loadEditorState returns null for unparsable JSON", () => {
    window.localStorage.setItem("ce-v1:broken.webflow.io", "{not valid json");
    expect(loadEditorState("broken.webflow.io")).toBeNull();
  });

  it("loading a different host does not overwrite the previous host's entry (TH-254 scope)", () => {
    const stateA = makeState({ url: "https://a.webflow.io" });
    const stateB = makeState({ url: "https://b.webflow.io" });

    saveEditorState("a.webflow.io", stateA);
    saveEditorState("b.webflow.io", stateB);

    expect(loadEditorState("a.webflow.io")).toEqual(stateA);
    expect(loadEditorState("b.webflow.io")).toEqual(stateB);
  });

  it("returning to a previously loaded host restores that host's stored files", () => {
    const stateA = makeState({ url: "https://a.webflow.io" });
    saveEditorState("a.webflow.io", stateA);
    saveEditorState("b.webflow.io", makeState({ url: "https://b.webflow.io" }));

    expect(loadEditorState("a.webflow.io")).toEqual(stateA);
  });
});

describe("F089 shape validation", () => {
  it("TH-shape: returns null when blocks is missing", () => {
    window.localStorage.setItem(
      "ce-v1:bad.webflow.io",
      JSON.stringify({ versions: {} }),
    );
    expect(loadEditorState("bad.webflow.io")).toBeNull();
  });

  it("TH-shape: returns null when a block has the wrong type field", () => {
    window.localStorage.setItem(
      "ce-v1:bad.webflow.io",
      JSON.stringify({
        blocks: [{ id: "b1", index: 0, type: "not-a-real-type", activeVersionId: "v1" }],
        versions: {},
      }),
    );
    expect(loadEditorState("bad.webflow.io")).toBeNull();
  });

  it("TH-shape: returns null when versions is not an object", () => {
    window.localStorage.setItem(
      "ce-v1:bad.webflow.io",
      JSON.stringify({ blocks: [], versions: "nope" }),
    );
    expect(loadEditorState("bad.webflow.io")).toBeNull();
  });

  it("TH-shape: returns null when a version entry is missing required fields", () => {
    window.localStorage.setItem(
      "ce-v1:bad.webflow.io",
      JSON.stringify({
        blocks: [],
        versions: { "block-1": [{ id: "v1", name: "Original" }] },
      }),
    );
    expect(loadEditorState("bad.webflow.io")).toBeNull();
  });

  it("TH-shape: accepts a state with no selectedBlockId/url (optional fields)", () => {
    const minimal = { blocks: [], versions: {} };
    window.localStorage.setItem("ce-v1:minimal.webflow.io", JSON.stringify(minimal));
    expect(loadEditorState("minimal.webflow.io")).toEqual(minimal);
  });
});

describe("F089 storage unavailable (private browsing / blocked storage)", () => {
  it("TH-shape/read-throws: loadEditorState returns null when localStorage.getItem throws", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    expect(loadEditorState("example.webflow.io")).toBeNull();
  });

  it("TH-shape/write-throws: saveEditorState does not throw when localStorage.setItem throws", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    expect(() => saveEditorState("example.webflow.io", makeState())).not.toThrow();
  });

  it("TH-shape/clear-throws: clearEditorState does not throw when localStorage.removeItem throws", () => {
    vi.spyOn(window.localStorage, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    expect(() => clearEditorState("example.webflow.io")).not.toThrow();
  });
});

describe("F091 quota failure handling", () => {
  it("TH-258: saveEditorState catches QuotaExceededError and warns instead of throwing", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const quotaError = new DOMException("The quota has been exceeded.", "QuotaExceededError");

    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw quotaError;
    });

    expect(() => saveEditorState("example.webflow.io", makeState())).not.toThrow();
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/quota/i);
  });

  it("TH-259: a failed save does not touch any previously stored state for the host", () => {
    const goodState = makeState({ url: "https://example.webflow.io" });
    saveEditorState("example.webflow.io", goodState);

    const quotaError = new DOMException("The quota has been exceeded.", "QuotaExceededError");
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw quotaError;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    saveEditorState(
      "example.webflow.io",
      makeState({ url: "https://example.webflow.io/other-page" }),
    );

    // setItem was mocked to throw, so the underlying store still has the
    // last value that was actually written before the mock was installed.
    vi.restoreAllMocks();
    expect(loadEditorState("example.webflow.io")).toEqual(goodState);
  });

  it("StorageQuotaError is exported for tests to reference, and is never thrown by saveEditorState", () => {
    expect(StorageQuotaError).toBeDefined();
    expect(new StorageQuotaError().name).toBe("StorageQuotaError");

    const quotaError = new DOMException("quota", "QuotaExceededError");
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw quotaError;
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    let thrown: unknown = null;
    try {
      saveEditorState("example.webflow.io", makeState());
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeNull();
  });
});

describe("origin / tab fields (moden-style file list)", () => {
  const HOST = "origin-test.webflow.io";

  it("round-trips origin, occurrences, isUserCreated and activeTab", () => {
    const state = makeState({ activeTab: "js" });
    state.blocks = state.blocks.map((b) => ({ ...b, origin: "embed", occurrences: 20, isUserCreated: false }));
    saveEditorState(HOST, state);
    const loaded = loadEditorState(HOST);
    expect(loaded?.activeTab).toBe("js");
    expect(loaded?.blocks[0].origin).toBe("embed");
    expect(loaded?.blocks[0].occurrences).toBe(20);
  });

  it("old saved blocks without origin still load", () => {
    const state = makeState();
    state.blocks = state.blocks.map(({ origin: _o, ...rest }) => rest);
    saveEditorState(HOST, state);
    expect(loadEditorState(HOST)).not.toBeNull();
  });

  it("rejects an unknown origin value", () => {
    const state = makeState();
    window.localStorage.setItem(
      getStorageKey(HOST),
      JSON.stringify({ ...state, blocks: state.blocks.map((b) => ({ ...b, origin: "sidebar" })) }),
    );
    expect(loadEditorState(HOST)).toBeNull();
  });

  it("drops a garbled activeTab without discarding the state", () => {
    window.localStorage.setItem(getStorageKey(HOST), JSON.stringify({ ...makeState(), activeTab: "html" }));
    const loaded = loadEditorState(HOST);
    expect(loaded).not.toBeNull();
    expect(loaded?.activeTab).toBeUndefined();
  });
});
