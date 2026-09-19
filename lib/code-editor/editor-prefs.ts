// F092 (TH-260) — Editor preferences, stored under their own localStorage
// key so they persist independently of any host's files/blocks/versions.

const STORAGE_KEY = 'ce-prefs-v1';

export interface EditorPrefs {
  fontSize: number; // default 14
  wordWrap: 'on' | 'off'; // default 'on'
  minimap: boolean; // default false
  theme: 'vs-dark' | 'vs'; // default 'vs-dark'
}

export const DEFAULT_EDITOR_PREFS: EditorPrefs = {
  fontSize: 14,
  wordWrap: 'on',
  minimap: false,
  theme: 'vs-dark',
};

function isEditorPrefsShape(value: unknown): value is Partial<EditorPrefs> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads editor preferences from localStorage, filling in defaults for any
 * missing/invalid field. Never throws: a missing key, malformed JSON, or an
 * unavailable `localStorage` (e.g. SSR, private-mode restrictions) all fall
 * back to `DEFAULT_EDITOR_PREFS`.
 */
export function loadEditorPrefs(): EditorPrefs {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return { ...DEFAULT_EDITOR_PREFS };
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_EDITOR_PREFS };
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isEditorPrefsShape(parsed)) {
      return { ...DEFAULT_EDITOR_PREFS };
    }
    return {
      fontSize:
        typeof parsed.fontSize === 'number' ? parsed.fontSize : DEFAULT_EDITOR_PREFS.fontSize,
      wordWrap:
        parsed.wordWrap === 'on' || parsed.wordWrap === 'off'
          ? parsed.wordWrap
          : DEFAULT_EDITOR_PREFS.wordWrap,
      minimap:
        typeof parsed.minimap === 'boolean' ? parsed.minimap : DEFAULT_EDITOR_PREFS.minimap,
      theme:
        parsed.theme === 'vs-dark' || parsed.theme === 'vs'
          ? parsed.theme
          : DEFAULT_EDITOR_PREFS.theme,
    };
  } catch {
    return { ...DEFAULT_EDITOR_PREFS };
  }
}

/**
 * Merges `prefs` into the currently stored preferences and writes the
 * result back to localStorage. Never throws: storage errors (quota,
 * unavailable localStorage, etc.) are swallowed so the caller's UI state
 * remains consistent even if persistence fails.
 */
export function saveEditorPrefs(prefs: Partial<EditorPrefs>): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return;
    }
    const current = loadEditorPrefs();
    const next: EditorPrefs = { ...current, ...prefs };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Swallow: preferences are a nice-to-have, never block the editor.
  }
}
