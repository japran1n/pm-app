// @vitest-environment jsdom
// TH-209..TH-219 (named version model) — lib/code-editor/versions.ts

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initVersions,
  forkFromOriginal,
  renameVersion,
  duplicateVersion,
  deleteVersion,
  restoreVersion,
  loadVersions,
  saveVersions,
} from "@/lib/code-editor/versions";

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

  it("test_TH_209_initVersions_returns_single_original_version", () => {
    const versions = initVersions("body { color: red; }");
    expect(versions).toHaveLength(1);
    expect(versions[0].name).toBe("Original");
    expect(versions[0].isOriginal).toBe(true);
    expect(versions[0].content).toBe("body { color: red; }");
  });

  it("test_TH_210_original_version_cannot_be_renamed", () => {
    const versions = initVersions("content");
    const renamed = renameVersion(versions, versions[0].id, "New name");
    expect(renamed[0].name).toBe("Original");
  });

  it("test_TH_210_original_version_cannot_be_deleted", () => {
    const versions = initVersions("content");
    const afterDelete = deleteVersion(versions, versions[0].id);
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete[0].isOriginal).toBe(true);
  });

  it("test_TH_209_210_forkFromOriginal_creates_a_named_editable_draft", () => {
    const versions = initVersions("original content");
    const forked = forkFromOriginal(versions);
    expect(forked).toHaveLength(2);
    const draft = forked[1];
    expect(draft.name).toBe("Draft");
    expect(draft.isOriginal).toBe(false);
    expect(draft.content).toBe("original content");
    // Original is untouched and still read-only.
    expect(forked[0].isOriginal).toBe(true);
    expect(forked[0].name).toBe("Original");
  });

  it("test_TH_212_a_non_original_version_can_be_renamed", () => {
    const forked = forkFromOriginal(initVersions("content"));
    const draftId = forked[1].id;
    const renamed = renameVersion(forked, draftId, "My draft");
    expect(renamed.find((v) => v.id === draftId)?.name).toBe("My draft");
  });

  it("test_TH_213_a_version_can_be_duplicated", () => {
    const forked = forkFromOriginal(initVersions("content"));
    const draft = forked[1];
    const duplicated = duplicateVersion(forked, draft.id);
    expect(duplicated).toHaveLength(3);
    const copy = duplicated[2];
    expect(copy.name).toBe(`Copy of ${draft.name}`);
    expect(copy.content).toBe(draft.content);
    expect(copy.isOriginal).toBe(false);
    expect(copy.id).not.toBe(draft.id);
  });

  it("test_TH_213_duplicating_the_original_produces_an_editable_copy", () => {
    const versions = initVersions("content");
    const duplicated = duplicateVersion(versions, versions[0].id);
    expect(duplicated).toHaveLength(2);
    expect(duplicated[1].isOriginal).toBe(false);
    expect(duplicated[1].name).toBe("Copy of Original");
  });

  it("test_TH_214_a_non_original_version_can_be_deleted", () => {
    const forked = forkFromOriginal(initVersions("content"));
    const draftId = forked[1].id;
    const afterDelete = deleteVersion(forked, draftId);
    expect(afterDelete).toHaveLength(1);
    expect(afterDelete.find((v) => v.id === draftId)).toBeUndefined();
  });

  it("test_TH_214_deleting_the_original_is_a_no_op", () => {
    const forked = forkFromOriginal(initVersions("content"));
    const originalId = forked[0].id;
    const afterDelete = deleteVersion(forked, originalId);
    expect(afterDelete).toHaveLength(2);
    expect(afterDelete.find((v) => v.id === originalId)).toBeDefined();
  });

  it("test_TH_217_no_limit_on_number_of_versions", () => {
    let versions = initVersions("content");
    for (let i = 0; i < 25; i++) {
      versions = duplicateVersion(versions, versions[0].id);
    }
    expect(versions).toHaveLength(26);
  });

  it("test_TH_217_persisted_versions_survive_a_round_trip_via_storage", () => {
    let versions = forkFromOriginal(initVersions("content"));
    versions = duplicateVersion(versions, versions[1].id);
    saveVersions("example.com", 0, versions);
    const loaded = loadVersions("example.com", 0, "content");
    expect(loaded).toHaveLength(3);
    expect(loaded.map((v) => v.name)).toEqual(versions.map((v) => v.name));
  });

  it("test_TH_218_restoreVersion_returns_content_for_a_version_id", () => {
    const forked = forkFromOriginal(initVersions("original content"));
    const draft = forked[1];
    expect(restoreVersion(forked, draft.id)).toBe("original content");
  });

  it("test_TH_218_restoreVersion_returns_null_for_unknown_id", () => {
    const versions = initVersions("content");
    expect(restoreVersion(versions, "does-not-exist")).toBeNull();
  });

  it("test_loadVersions_initializes_a_single_original_when_nothing_persisted", () => {
    const versions = loadVersions("example.com", 0, "fresh content");
    expect(versions).toHaveLength(1);
    expect(versions[0].name).toBe("Original");
    expect(versions[0].content).toBe("fresh content");
  });

  it("test_versions_are_scoped_per_block_within_a_host", () => {
    saveVersions("example.com", 0, initVersions("block-0-content"));
    saveVersions("example.com", 1, initVersions("block-1-content"));
    expect(loadVersions("example.com", 0, "")[0].content).toBe("block-0-content");
    expect(loadVersions("example.com", 1, "")[0].content).toBe("block-1-content");
  });

  it("test_versions_are_scoped_per_hostname", () => {
    saveVersions("host-a.com", 0, initVersions("content-a"));
    saveVersions("host-b.com", 0, initVersions("content-b"));
    expect(loadVersions("host-a.com", 0, "")[0].content).toBe("content-a");
    expect(loadVersions("host-b.com", 0, "")[0].content).toBe("content-b");
  });

  it("test_saveVersions_does_not_throw_when_localStorage_setItem_fails", () => {
    const spy = vi
      .spyOn(window.Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    expect(() => saveVersions("example.com", 0, initVersions("content"))).not.toThrow();
    spy.mockRestore();
  });

  it("test_loadVersions_does_not_throw_when_localStorage_getItem_fails", () => {
    const spy = vi
      .spyOn(window.Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });
    expect(() => loadVersions("example.com", 0, "fallback")).not.toThrow();
    expect(loadVersions("example.com", 0, "fallback")[0].content).toBe("fallback");
    spy.mockRestore();
  });

  it("test_loadVersions_falls_back_to_original_for_corrupt_json", () => {
    window.localStorage.setItem("ce-versions-v1:example.com", "not-json{{{");
    const versions = loadVersions("example.com", 0, "fallback content");
    expect(versions).toHaveLength(1);
    expect(versions[0].content).toBe("fallback content");
  });

  it("test_loadVersions_discards_corrupted_entries_within_an_otherwise_valid_store", () => {
    const valid = initVersions("good content");
    window.localStorage.setItem(
      "ce-versions-v1:example.com",
      JSON.stringify({ "example.com:0": [...valid, { garbage: true }] }),
    );
    const versions = loadVersions("example.com", 0, "fallback");
    expect(versions).toHaveLength(1);
    expect(versions[0].content).toBe("good content");
  });
});
