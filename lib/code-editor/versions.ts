// TH-209..TH-219 — client-side version history for code editor blocks.
//
// Versions are stored in localStorage, keyed per hostname (`ce-versions-v1:{hostname}`).
// Within a host's store, each block is keyed by `${hostname}:${blockIndex}`.
// No server/DB involvement — this is a purely client-side feature (Round 1
// discovery: no DB). Every localStorage access is wrapped in try/catch so a
// quota error or unavailable storage (private browsing, SSR) never throws
// out of these functions.

export interface BlockVersion {
  timestamp: number;
  content: string;
  label?: string;
}

export interface VersionStore {
  [blockKey: string]: BlockVersion[];
}

const MAX_VERSIONS_PER_BLOCK = 10;

function storageKey(hostname: string): string {
  return `ce-versions-v1:${hostname}`;
}

function blockKey(hostname: string, blockIndex: number): string {
  return `${hostname}:${blockIndex}`;
}

function readStore(hostname: string): VersionStore {
  try {
    if (typeof window === "undefined" || typeof window.localStorage === "undefined") return {};
    const raw = window.localStorage.getItem(storageKey(hostname));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as VersionStore;
    }
    return {};
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
    // working against in-memory state (TH-259 equivalent for versions).
  }
}

/**
 * Saves a new version for a block, evicting the oldest version once the
 * cap of 10 per block is exceeded.
 */
export function saveVersion(
  hostname: string,
  blockIndex: number,
  content: string,
  label?: string
): void {
  try {
    const store = readStore(hostname);
    const key = blockKey(hostname, blockIndex);
    const existing = store[key] ?? [];
    const next: BlockVersion[] = [
      ...existing,
      { timestamp: Date.now(), content, ...(label ? { label } : {}) },
    ];
    while (next.length > MAX_VERSIONS_PER_BLOCK) {
      next.shift();
    }
    store[key] = next;
    writeStore(hostname, store);
  } catch {
    // Never throw from a persistence side-effect.
  }
}

/**
 * Returns all saved versions for a block, oldest first. Empty array if
 * none exist or storage is unavailable.
 */
export function getVersions(hostname: string, blockIndex: number): BlockVersion[] {
  try {
    const store = readStore(hostname);
    return store[blockKey(hostname, blockIndex)] ?? [];
  } catch {
    return [];
  }
}

/**
 * Returns the content of the version at `versionIndex` for the given block,
 * or null if the block/version does not exist.
 */
export function restoreVersion(
  hostname: string,
  blockIndex: number,
  versionIndex: number
): string | null {
  try {
    const versions = getVersions(hostname, blockIndex);
    const version = versions[versionIndex];
    return version ? version.content : null;
  } catch {
    return null;
  }
}
