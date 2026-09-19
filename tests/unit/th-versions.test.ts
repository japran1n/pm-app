// @vitest-environment jsdom
// TH-209..TH-219 (version model) — lib/code-editor/versions.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveVersion, getVersions, restoreVersion } from "@/lib/code-editor/versions";

// Node 26 + jsdom 30 only expose a global `localStorage` when the process
// is launched with `--localstorage-file`, which the test runner does not
// set, so `window.localStorage` comes back `undefined` here. Same gap as
// tests/unit/th-storage.test.ts — install the same minimal in-memory
// `Storage` polyfill so these tests exercise the real code paths in
// lib/code-editor/versions.ts.
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

describe("versions.ts", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("test_TH_209_saveVersion_and_getVersions_round_trip", () => {
    saveVersion("example.com", 0, "body { color: red; }");
    const versions = getVersions("example.com", 0);
    expect(versions).toHaveLength(1);
    expect(versions[0].content).toBe("body { color: red; }");
    expect(typeof versions[0].timestamp).toBe("number");
  });

  it("test_TH_211_saveVersion_stores_optional_label", () => {
    saveVersion("example.com", 0, "content-a", "my label");
    const versions = getVersions("example.com", 0);
    expect(versions[0].label).toBe("my label");
  });

  it("test_TH_211_saveVersion_without_label_has_no_label_field", () => {
    saveVersion("example.com", 0, "content-a");
    const versions = getVersions("example.com", 0);
    expect(versions[0].label).toBeUndefined();
  });

  it("test_TH_217_no_cap_below_ten_versions_are_all_kept", () => {
    for (let i = 0; i < 5; i++) {
      saveVersion("example.com", 1, `content-${i}`);
    }
    expect(getVersions("example.com", 1)).toHaveLength(5);
  });

  it("test_TH_217_evicts_oldest_when_exceeding_ten_versions", () => {
    for (let i = 0; i < 12; i++) {
      saveVersion("example.com", 2, `content-${i}`);
    }
    const versions = getVersions("example.com", 2);
    expect(versions).toHaveLength(10);
    // Oldest two (content-0, content-1) were evicted; oldest remaining is content-2.
    expect(versions[0].content).toBe("content-2");
    expect(versions[versions.length - 1].content).toBe("content-11");
  });

  it("test_TH_209_versions_are_scoped_per_block_within_a_host", () => {
    saveVersion("example.com", 0, "block-0-content");
    saveVersion("example.com", 1, "block-1-content");
    expect(getVersions("example.com", 0)).toHaveLength(1);
    expect(getVersions("example.com", 1)).toHaveLength(1);
    expect(getVersions("example.com", 0)[0].content).toBe("block-0-content");
  });

  it("test_TH_250_versions_are_scoped_per_hostname", () => {
    saveVersion("host-a.com", 0, "content-a");
    saveVersion("host-b.com", 0, "content-b");
    expect(getVersions("host-a.com", 0)).toHaveLength(1);
    expect(getVersions("host-b.com", 0)).toHaveLength(1);
    expect(getVersions("host-a.com", 0)[0].content).toBe("content-a");
  });

  it("test_TH_218_restoreVersion_returns_content_at_index", () => {
    saveVersion("example.com", 0, "v0");
    saveVersion("example.com", 0, "v1");
    saveVersion("example.com", 0, "v2");
    expect(restoreVersion("example.com", 0, 1)).toBe("v1");
  });

  it("test_TH_218_restoreVersion_returns_null_for_missing_block", () => {
    expect(restoreVersion("example.com", 99, 0)).toBeNull();
  });

  it("test_TH_218_restoreVersion_returns_null_for_out_of_range_index", () => {
    saveVersion("example.com", 0, "v0");
    expect(restoreVersion("example.com", 0, 5)).toBeNull();
  });

  it("test_TH_219_getVersions_returns_empty_array_when_nothing_saved", () => {
    expect(getVersions("example.com", 0)).toEqual([]);
  });

  it("test_TH_211_saveVersion_does_not_throw_when_localStorage_setItem_fails", () => {
    const spy = vi
      .spyOn(window.Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => saveVersion("example.com", 0, "content")).not.toThrow();
    spy.mockRestore();
  });

  it("test_TH_218_getVersions_does_not_throw_when_localStorage_getItem_fails", () => {
    const spy = vi
      .spyOn(window.Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    expect(() => getVersions("example.com", 0)).not.toThrow();
    expect(getVersions("example.com", 0)).toEqual([]);
    spy.mockRestore();
  });

  it("test_TH_218_getVersions_returns_empty_array_for_corrupt_json", () => {
    window.localStorage.setItem("ce-versions-v1:example.com", "not-json{{{");
    expect(getVersions("example.com", 0)).toEqual([]);
  });
});
