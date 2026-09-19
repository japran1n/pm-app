// TH-209..TH-219 — client-side named version history for code editor blocks.
//
// Model: every block starts with a single read-only "Original" version (the
// block's initial content). The first edit forks a new, named, editable
// version ("Draft") off Original and makes it active; further versions are
// created by explicit user action (duplicate) or automatically on first
// edit. Original can never be renamed or deleted.
//
// Versions are stored in localStorage, keyed per hostname
// (`ce-versions-v1:{hostname}`). Within a host's store, each block is keyed
// by `${hostname}:${blockIndex}`. No server/DB involvement — this is a
// purely client-side feature (Round 1 discovery: no DB). Every localStorage
// access is wrapped in try/catch so a quota error or unavailable storage
// (private browsing, SSR) never throws out of these functions.

export interface Version {
  id: string;
  name: string;
  content: string;
  isOriginal: boolean;
  createdAt: number;
}

export interface VersionStore {
  [blockKey: string]: Version[];
}

function storageKey(hostname: string): string {
  return `ce-versions-v1:${hostname}`;
}

function blockKey(hostname: string, blockIndex: number): string {
  return `${hostname}:${blockIndex}`;
}

function uuid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to fallback below
  }
  return `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isValidVersion(value: unknown): value is Version {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.content === "string" &&
    typeof v.isOriginal === "boolean" &&
    typeof v.createdAt === "number"
  );
}

function readStore(hostname: string): VersionStore {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return {};
    const raw = window.localStorage.getItem(storageKey(hostname));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const store: VersionStore = {};
    for (const [key, versions] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(versions)) continue;
      // Discard individual corrupted entries rather than the whole block's
      // history, and discard the whole block's history if nothing valid
      // remains -- either way, this must never throw.
      const valid = versions.filter(isValidVersion);
      if (valid.length > 0) store[key] = valid;
    }
    return store;
  } catch {
    return {};
  }
}

function writeStore(hostname: string, store: VersionStore): void {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
    window.localStorage.setItem(storageKey(hostname), JSON.stringify(store));
  } catch {
    // Storage unavailable or quota exceeded — silently no-op. Callers keep
    // working against in-memory state.
  }
}

/** Builds the initial single-version list for a freshly-opened block. */
export function initVersions(initialContent: string): Version[] {
  return [
    {
      id: uuid(),
      name: "Original",
      content: initialContent,
      isOriginal: true,
      createdAt: Date.now(),
    },
  ];
}

/**
 * TH-211: the first edit to a read-only ("Original"-only) version list
 * forks a new named, editable version off Original and appends it. Callers
 * should also mark the forked version active.
 */
export function forkFromOriginal(versions: Version[], name = "Draft"): Version[] {
  const original = versions.find((v) => v.isOriginal) ?? versions[0];
  const draft: Version = {
    id: uuid(),
    name,
    content: original ? original.content : "",
    isOriginal: false,
    createdAt: Date.now(),
  };
  return [...versions, draft];
}

/** TH-212: renames a version. The "Original" version can never be renamed. */
export function renameVersion(versions: Version[], id: string, name: string): Version[] {
  return versions.map((v) => (v.id === id && !v.isOriginal ? { ...v, name } : v));
}

/** TH-213: duplicates any version (including Original) into a new, editable version. */
export function duplicateVersion(versions: Version[], id: string): Version[] {
  const source = versions.find((v) => v.id === id);
  if (!source) return versions;
  const copy: Version = {
    id: uuid(),
    name: `Copy of ${source.name}`,
    content: source.content,
    isOriginal: false,
    createdAt: Date.now(),
  };
  return [...versions, copy];
}

/**
 * TH-214/TH-215: deletes a version. The "Original" version can never be
 * deleted; deleting a version that doesn't exist (or Original) is a no-op.
 */
export function deleteVersion(versions: Version[], id: string): Version[] {
  const target = versions.find((v) => v.id === id);
  if (!target || target.isOriginal) return versions;
  return versions.filter((v) => v.id !== id);
}

/** Returns the content for a version id, or null if it doesn't exist. */
export function restoreVersion(versions: Version[], id: string): string | null {
  const version = versions.find((v) => v.id === id);
  return version ? version.content : null;
}

/**
 * Loads the version list for a block, initializing it (a single "Original"
 * entry) on first access. Corrupted persisted entries are discarded rather
 * than surfaced -- this never throws.
 */
export function loadVersions(hostname: string, blockIndex: number, initialContent: string): Version[] {
  try {
    const store = readStore(hostname);
    const existing = store[blockKey(hostname, blockIndex)];
    if (existing && existing.length > 0) return existing;
    return initVersions(initialContent);
  } catch {
    return initVersions(initialContent);
  }
}

/** Persists the full version list for a block. */
export function saveVersions(hostname: string, blockIndex: number, versions: Version[]): void {
  try {
    const store = readStore(hostname);
    store[blockKey(hostname, blockIndex)] = versions;
    writeStore(hostname, store);
  } catch {
    // Never throw from a persistence side-effect.
  }
}
