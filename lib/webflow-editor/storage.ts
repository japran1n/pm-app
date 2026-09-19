// F089 (TH-250..TH-255), F090 (TH-256, TH-257), F091 (TH-258, TH-259) —
// per-host localStorage persistence for the code editor tool.
//
// Key format: `ce-v1:{hostname}` where hostname is the .webflow.io hostname
// (lowercased). Storage is client-only: nothing here ever touches the
// application database (TH-261).
//
// Data shape (F089 clarification, round A Q2):
//   { blocks: Block[], versions: { [blockId: string]: Version[] } }

const STORAGE_PREFIX = "ce-v1:";

export interface StoredBlock {
  id: string; // stable identity across sessions (rebinding, F086)
  index: number; // 0-based position in document
  type: "style" | "script";
  name?: string;
  activeVersionId: string;
}

export interface StoredVersion {
  id: string;
  name: string;
  content: string;
  readOnly?: boolean;
  createdAt: string; // ISO timestamp
}

export interface EditorState {
  blocks: StoredBlock[];
  versions: Record<string, StoredVersion[]>;
  selectedBlockId?: string | null;
  url?: string;
}

/**
 * Thrown-in-spirit marker for quota failures. Never actually thrown by
 * `saveEditorState` -- exported so tests can reference it by name/identity
 * when asserting on the quota-failure code path (F091).
 */
export class StorageQuotaError extends Error {
  constructor(message = "localStorage quota exceeded") {
    super(message);
    this.name = "StorageQuotaError";
  }
}

/** Returns the localStorage key for a given hostname. */
export function getStorageKey(hostname: string): string {
  return `${STORAGE_PREFIX}${hostname}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidBlock(value: unknown): value is StoredBlock {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.index !== "number") return false;
  if (value.type !== "style" && value.type !== "script") return false;
  if (typeof value.activeVersionId !== "string") return false;
  if (value.name !== undefined && typeof value.name !== "string") return false;
  return true;
}

function isValidVersion(value: unknown): value is StoredVersion {
  if (!isPlainObject(value)) return false;
  if (typeof value.id !== "string") return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.content !== "string") return false;
  if (typeof value.createdAt !== "string") return false;
  if (value.readOnly !== undefined && typeof value.readOnly !== "boolean") {
    return false;
  }
  return true;
}

/**
 * Validates the shape of a parsed JSON value against `EditorState`. Returns
 * the narrowed value on success, or null if the shape is malformed in any
 * way (missing fields, wrong types, unexpected structure).
 */
function validateEditorState(value: unknown): EditorState | null {
  if (!isPlainObject(value)) return null;
  if (!Array.isArray(value.blocks)) return null;
  if (!value.blocks.every(isValidBlock)) return null;

  if (!isPlainObject(value.versions)) return null;
  for (const key of Object.keys(value.versions)) {
    const versionList = value.versions[key];
    if (!Array.isArray(versionList) || !versionList.every(isValidVersion)) {
      return null;
    }
  }

  if (
    value.selectedBlockId !== undefined &&
    value.selectedBlockId !== null &&
    typeof value.selectedBlockId !== "string"
  ) {
    return null;
  }

  if (value.url !== undefined && typeof value.url !== "string") {
    return null;
  }

  return value as unknown as EditorState;
}

/**
 * Loads persisted editor state for a host. Returns null if there is no
 * stored data, the data is malformed, or localStorage is unavailable
 * (private browsing, storage disabled, etc). Never throws.
 */
export function loadEditorState(hostname: string): EditorState | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }

    const raw = window.localStorage.getItem(getStorageKey(hostname));
    if (!raw) {
      return null;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    return validateEditorState(parsed);
  } catch {
    // localStorage can throw in private browsing / blocked-storage contexts.
    return null;
  }
}

/**
 * Persists editor state for a host. Wrapped in try/catch so that quota
 * failures and unavailable-storage contexts degrade silently -- the caller's
 * in-memory state is never affected by a failed save (TH-258, TH-259).
 */
export function saveEditorState(hostname: string, state: EditorState): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }

    const serialized = JSON.stringify(state);
    window.localStorage.setItem(getStorageKey(hostname), serialized);
  } catch (err) {
    if (isQuotaExceededError(err)) {
      console.warn(
        `[code-editor] localStorage quota exceeded while saving state for "${hostname}" -- changes were not persisted.`,
      );
      return;
    }

    // Any other localStorage failure (private browsing, disabled storage,
    // etc) also degrades silently -- never throw from a save.
    console.warn(
      `[code-editor] failed to save editor state for "${hostname}":`,
      err,
    );
  }
}

/** Removes the stored state for a host. Never throws. */
export function clearEditorState(hostname: string): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    window.localStorage.removeItem(getStorageKey(hostname));
  } catch {
    // localStorage can throw in private browsing / blocked-storage contexts.
  }
}

function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  // Firefox uses name "NS_ERROR_DOM_QUOTA_REACHED" as .name in older
  // versions; modern browsers (and DOMException) use the standard
  // "QuotaExceededError" name, sometimes with DOMException.code === 22.
  if (name === "QuotaExceededError") return true;
  if (name === "NS_ERROR_DOM_QUOTA_REACHED") return true;
  const code = (err as { code?: number }).code;
  return code === 22 || code === 1014;
}
