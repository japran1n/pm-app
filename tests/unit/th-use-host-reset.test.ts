// @vitest-environment jsdom
// F088b — lib/code-editor/use-host-reset.ts calls clearEditorState on the
// previous hostname's persisted state when the hostname changes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHostReset } from "@/lib/code-editor/use-host-reset";
import * as storage from "@/lib/webflow-editor/storage";

// Node 26 + jsdom 30 only expose a global `localStorage` when the process
// is launched with `--localstorage-file`, which the test runner does not
// set, so `window.localStorage` comes back `undefined` here. Same gap as
// tests/unit/th-storage.test.ts — install the same minimal in-memory
// `Storage` polyfill.
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

describe("useHostReset", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("test_AS_host_reset_clears_previous_host_storage_on_change", () => {
    const clearSpy = vi.spyOn(storage, "clearEditorState");
    const onReset = vi.fn();

    const { rerender } = renderHook(
      ({ hostname }) => useHostReset(hostname, onReset),
      { initialProps: { hostname: "a.webflow.io" } },
    );

    expect(clearSpy).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();

    rerender({ hostname: "b.webflow.io" });

    expect(clearSpy).toHaveBeenCalledWith("a.webflow.io");
    expect(onReset).toHaveBeenCalledTimes(1);

    clearSpy.mockRestore();
  });

  it("does not clear storage on initial mount", () => {
    const clearSpy = vi.spyOn(storage, "clearEditorState");
    renderHook(() => useHostReset("a.webflow.io", vi.fn()));
    expect(clearSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it("does not clear storage when hostname is unchanged", () => {
    const clearSpy = vi.spyOn(storage, "clearEditorState");
    const { rerender } = renderHook(
      ({ hostname }) => useHostReset(hostname, vi.fn()),
      { initialProps: { hostname: "a.webflow.io" } },
    );
    rerender({ hostname: "a.webflow.io" });
    expect(clearSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
