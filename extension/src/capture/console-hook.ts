// F289 — AS-550, AS-551, AS-552: capture console errors/warnings (plus
// uncaught errors and unhandled promise rejections) into a bounded ring
// buffer, and let the popup show what's captured.
//
// ---------------------------------------------------------------------
// Orchestrator-resolved scope note (do not re-litigate — see this
// feature's handoff "Decisions made" for the full reasoning): the
// feature spec's draft scope said "content script injected at
// document_start in the MAIN world" across arbitrary pages. That would
// require a statically-declared `content_scripts` entry (or
// `<all_urls>`) matching every page up front, which directly conflicts
// with tech-decisions.md's locked "`activeTab` only — no `<all_urls>`"
// decision (already implemented: manifest.json's only `content_scripts`
// entry is scoped to this app's own `/extension-connect*` origin).
//
// This feature instead follows the SAME gesture-gated pattern F287's
// `element-picker.ts` established: the hook is injected via
// `chrome.scripting.executeScript` (with `world: "MAIN"` so it patches
// the *page's own* `console`/`window`, not an isolated-world copy),
// triggered by a popup button the user clicks ("Start capturing console
// output"). Consequently the hook can only ever see console activity
// that happens AFTER that click — nothing from page load or
// `document_start`. Per AS-552, this is stated in the popup UI in plain
// language, and per the clarification's "less data, simpler, more
// private" default, capture does not start silently or automatically.
// ---------------------------------------------------------------------
//
// Injected-code duplication note (same tradeoff as element-picker.ts):
// `chrome.scripting.executeScript({ func })` serializes `func` and runs
// it with no closure over this module, so `installConsoleHookInPage`
// below contains a small duplicated copy of the ring-buffer eviction
// logic (`ring-buffer.ts` remains canonical/unit-tested) and of the
// serializer (also unit-tested standalone as `serializeLogArgument`
// below, used directly by non-injected callers/tests).

export type ConsoleLogLevel = "error" | "warn";
export type ConsoleLogSource = "console" | "onerror" | "unhandledrejection";

export type ConsoleLogEntry = {
  level: ConsoleLogLevel;
  source: ConsoleLogSource;
  timestamp: number;
  message: string;
};

// AS-551: last 200 entries. Chosen as a round number comfortably larger
// than the handful of log lines a real bug report needs (most bug
// reports hinge on the last few errors before/around the reported
// behaviour), while still bounding memory and payload size hard —
// worst case ~200 entries * a few hundred truncated chars each is well
// under anything that would make the eventual report payload slow to
// serialize or upload. Matches the spec's own suggested figure.
export const MAX_CONSOLE_ENTRIES = 200;

// Per-argument serialized payload is truncated so one huge logged
// object (or a giant string) can't blow past the bounded-buffer intent
// by making a single entry arbitrarily large.
const MAX_MESSAGE_LENGTH = 2000;

const WINDOW_KEY = "__pmAppConsoleCapture__";

/**
 * Serializes a single console-argument (or thrown error/rejection
 * reason) into a readable string, NEVER throwing regardless of what is
 * passed in — circular objects, DOM nodes, Error instances, functions,
 * undefined/null, symbols, bigints, etc. all produce *something*
 * readable rather than crashing the hook (a crash here would silently
 * break console capture at exactly the moment a real error is
 * happening on the page, which is the worst possible time for a
 * QA-capture tool to go dark).
 */
export function serializeLogArgument(value: unknown): string {
  try {
    if (value === undefined) return "undefined";
    if (value === null) return "null";
    if (typeof value === "string") return truncate(value);
    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
      return truncate(String(value));
    }
    if (typeof value === "symbol") {
      return truncate(value.toString());
    }
    if (typeof value === "function") {
      return truncate(`[Function: ${value.name || "anonymous"}]`);
    }
    if (value instanceof Error) {
      return truncate(`${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`);
    }
    // DOM nodes: check for a tagName/nodeType duck-type instead of
    // `instanceof Element`/`Node`, so this also works when serialized
    // inside a page context that may not share the exact same
    // Element/Node constructor identity as this module's own realm.
    if (isDomNodeLike(value)) {
      return truncate(describeDomNode(value));
    }
    return truncate(stringifyWithCircularGuard(value));
  } catch {
    // Absolute last resort — this branch should be unreachable given
    // the guards above, but the contract is "never throws", not
    // "never throws unless I was clever enough".
    return "[unserializable value]";
  }
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LENGTH
    ? `${text.slice(0, MAX_MESSAGE_LENGTH)}… [truncated]`
    : text;
}

function isDomNodeLike(value: unknown): value is { tagName?: string; nodeType?: number; id?: string; className?: string } {
  return typeof value === "object" && value !== null && "nodeType" in value;
}

function describeDomNode(node: { tagName?: string; nodeType?: number; id?: string; className?: string }): string {
  const tag = node.tagName ? node.tagName.toLowerCase() : `node(type=${node.nodeType})`;
  const id = node.id ? `#${node.id}` : "";
  const cls =
    typeof node.className === "string" && node.className
      ? `.${node.className.trim().split(/\s+/).join(".")}`
      : "";
  return `<${tag}${id}${cls}>`;
}

function stringifyWithCircularGuard(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]";
      seen.add(val);
    }
    if (typeof val === "bigint") return val.toString();
    return val;
  });
}

export function formatArgs(args: unknown[]): string {
  return args.map(serializeLogArgument).join(" ");
}

/**
 * Self-contained function injected via `chrome.scripting.executeScript`
 * (`world: "MAIN"`). Installs the console/error hooks directly on the
 * real page window the user is reporting a bug on. Idempotent — calling
 * it twice (e.g. the user clicks "start capturing" more than once) does
 * not double-wrap console methods or reset the buffer.
 */
function installConsoleHookInPage(maxEntries: number, windowKey: string): { ok: true } {
  const w = window as unknown as Record<string, unknown>;
  if (w[windowKey]) {
    // Already installed — no-op, keep the existing buffer intact.
    return { ok: true };
  }

  const buffer: Array<{ level: string; source: string; timestamp: number; message: string }> = [];

  function push(level: string, source: string, message: string) {
    buffer.push({ level, source, timestamp: Date.now(), message });
    while (buffer.length > maxEntries) {
      buffer.shift();
    }
  }

  // Duplicated from serializeLogArgument above (see file header for why
  // this can't just import it) — kept in lock-step by comment
  // cross-reference and by the shared "never throws" contract.
  function serializeInPage(value: unknown): string {
    try {
      if (value === undefined) return "undefined";
      if (value === null) return "null";
      const t = typeof value;
      if (t === "string") return truncateInPage(value as string);
      if (t === "number" || t === "boolean" || t === "bigint") {
        return truncateInPage(String(value));
      }
      if (t === "symbol") {
        return truncateInPage((value as symbol).toString());
      }
      if (t === "function") {
        const fn = value as (...a: unknown[]) => unknown;
        return truncateInPage(`[Function: ${fn.name || "anonymous"}]`);
      }
      if (value instanceof Error) {
        return truncateInPage(`${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ""}`);
      }
      if (typeof value === "object" && value !== null && "nodeType" in (value as object)) {
        const node = value as { tagName?: string; nodeType?: number; id?: string; className?: string };
        const tag = node.tagName ? node.tagName.toLowerCase() : `node(type=${node.nodeType})`;
        const id = node.id ? `#${node.id}` : "";
        const cls =
          typeof node.className === "string" && node.className
            ? `.${node.className.trim().split(/\s+/).join(".")}`
            : "";
        return truncateInPage(`<${tag}${id}${cls}>`);
      }
      const seen = new WeakSet<object>();
      return truncateInPage(
        JSON.stringify(value, (_key, val) => {
          if (typeof val === "object" && val !== null) {
            if (seen.has(val)) return "[Circular]";
            seen.add(val);
          }
          if (typeof val === "bigint") return val.toString();
          return val;
        }),
      );
    } catch {
      return "[unserializable value]";
    }
  }

  function truncateInPage(text: string): string {
    const max = 2000;
    return text.length > max ? `${text.slice(0, max)}… [truncated]` : text;
  }

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    try {
      push("error", "console", args.map(serializeInPage).join(" "));
    } catch {
      // never let capture itself break the page's real console.error call
    }
    originalError(...args);
  };

  console.warn = (...args: unknown[]) => {
    try {
      push("warn", "console", args.map(serializeInPage).join(" "));
    } catch {
      // as above
    }
    originalWarn(...args);
  };

  window.addEventListener("error", (event: ErrorEvent) => {
    try {
      const message = event.error
        ? serializeInPage(event.error)
        : serializeInPage(event.message ?? "Unknown error");
      push("error", "onerror", message);
    } catch {
      // as above
    }
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    try {
      push("error", "unhandledrejection", serializeInPage(event.reason));
    } catch {
      // as above
    }
  });

  w[windowKey] = { installedAt: Date.now(), buffer };
  return { ok: true };
}

/**
 * Self-contained function injected to read back whatever the hook has
 * captured so far, without disturbing it (called any number of times
 * while capture is running).
 */
function readConsoleCaptureFromPage(
  windowKey: string,
): { installed: false } | { installed: true; entries: ConsoleLogEntry[] } {
  const w = window as unknown as Record<string, unknown>;
  const state = w[windowKey] as
    | { installedAt: number; buffer: Array<{ level: string; source: string; timestamp: number; message: string }> }
    | undefined;
  if (!state) return { installed: false };
  return {
    installed: true,
    entries: state.buffer.map((e) => ({
      level: e.level as ConsoleLogLevel,
      source: e.source as ConsoleLogSource,
      timestamp: e.timestamp,
      message: e.message,
    })),
  };
}

export type StartCaptureResult = { ok: true } | { ok: false; reason: string };

/**
 * Starts console capture on whichever tab is currently active — must be
 * called synchronously enough after a user gesture (a popup button
 * click) the same way `pickElementOnActiveTab` in element-picker.ts is.
 * AS-552: everything captured from this point forward is included;
 * nothing from before this call ever can be (see file header).
 */
export async function startConsoleCaptureOnActiveTab(): Promise<StartCaptureResult> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Could not find the active tab." };
  }
  if (!tab?.id) {
    return { ok: false, reason: "No active tab available to start capturing console output on." };
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: installConsoleHookInPage,
      args: [MAX_CONSOLE_ENTRIES, WINDOW_KEY],
    });
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? err.message
          : "Could not start console capture on this page.",
    };
  }
}

export type GetCaptureResult =
  | { ok: true; installed: false; entries: [] }
  | { ok: true; installed: true; entries: ConsoleLogEntry[] }
  | { ok: false; reason: string };

/** Reads back whatever the hook (if started) has captured on the active tab. */
export async function getConsoleCaptureFromActiveTab(): Promise<GetCaptureResult> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "Could not find the active tab." };
  }
  if (!tab?.id) {
    return { ok: false, reason: "No active tab available to read captured console output from." };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: readConsoleCaptureFromPage,
      args: [WINDOW_KEY],
    });
    const result = results[0]?.result as
      | { installed: false }
      | { installed: true; entries: ConsoleLogEntry[] }
      | undefined;
    if (!result) {
      return { ok: false, reason: "Could not read captured console output from this page." };
    }
    if (!result.installed) {
      return { ok: true, installed: false, entries: [] };
    }
    return { ok: true, installed: true, entries: result.entries };
  } catch (err) {
    return {
      ok: false,
      reason:
        err instanceof Error
          ? err.message
          : "Could not read captured console output from this page.",
    };
  }
}
