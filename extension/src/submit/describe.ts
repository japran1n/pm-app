// F295 — AS-560: assembles the final plain-text description sent to
// F292's POST /api/extension/tasks route by appending a structured,
// readable technical-metadata block AFTER the reporter's own free-text
// description.
//
// M14 fallback note (per this feature's spec, "uses the rich-text
// document format from M14 (F170) when available; falls back to plain
// text and says so in the handoff if M14 has not landed"): as of this
// mission, no `lib/editor/` directory or F170 handoff exists, and
// `lib/validation/tasks.ts`'s `description` field is a plain `string`
// (see createTaskSchema). This module therefore builds a single combined
// PLAIN TEXT string — no rich-text document shape is invented or guessed
// at here. If/when M14 lands, a future feature can swap this module's
// output type without changing its call sites' contract (a plain string
// in, a plain string out).
//
// Ordering (spec: "the reporter's own words come first — the machine
// detail must not bury them."): this function always places the
// reporter's own text, byte-for-byte and unmodified, at the very start
// of the returned string. The metadata block is appended after a clear
// `---` delimiter, never interleaved or prepended.
//
// Truncation (spec: "long console dumps belong in an attachment or a
// collapsed block, not inline in the description" + clarification's
// simpler/less-data tie-breaker): this feature has no attachment-building
// scope of its own (F294 already built the screenshot attachment path;
// building a second attachment type for logs is out of scope for this
// feature's file list). Console/network entries are instead rendered as a
// bounded inline excerpt — the most recent N entries of each — with an
// explicit "... and N more entries not shown" note when entries were
// omitted, per this mission's "state what happened, never a silent
// no-op" rule. F289/F290's own ring buffers already cap each source at
// MAX_CONSOLE_ENTRIES/MAX_NETWORK_ENTRIES = 200; this feature's own
// excerpt limit is deliberately much smaller (10) to keep the assembled
// description itself readable in a task detail view rather than becoming
// its own wall of text.
export const MAX_CONSOLE_ENTRIES_IN_DESCRIPTION = 10;
export const MAX_NETWORK_ENTRIES_IN_DESCRIPTION = 10;

export type DescribeEnvironment = {
  pageUrl: string;
  browserName: string;
  browserVersion: string;
  os: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
};

export type DescribeElement = {
  selector: string;
};

export type DescribeConsoleEntry = {
  level: string;
  source: string;
  timestamp: number;
  message: string;
};

export type DescribeNetworkEntry = {
  method: string;
  url: string;
  status: number | null;
  duration: number;
  timestamp: number;
};

export type BuildDescriptionInput = {
  /** The reporter's own free-text description, exactly as typed. May be empty. */
  reporterText: string;
  /** F288's `collectEnvironmentMetadata()` result, if available. */
  environment?: DescribeEnvironment | null;
  /** F287's picked-element result, if the reporter used the picker. */
  element?: DescribeElement | null;
  /** F289's captured console entries, if console capture was started. */
  consoleEntries?: DescribeConsoleEntry[] | null;
  /** F290's captured network-failure entries, if network capture was started. */
  networkEntries?: DescribeNetworkEntry[] | null;
};

const SEPARATOR = "---";
const METADATA_HEADING = "Technical details (captured automatically)";

function formatConsoleEntry(entry: DescribeConsoleEntry): string {
  return `- [${entry.level}] (${entry.source}) ${entry.message}`;
}

function formatNetworkEntry(entry: DescribeNetworkEntry): string {
  const status = entry.status === null ? "network error" : String(entry.status);
  return `- ${entry.method} ${entry.url} — ${status} (${Math.round(entry.duration)}ms)`;
}

/** Sorts oldest-first (F289/F290 already push in capture order, but this
 * doesn't assume that), then keeps the most RECENT `limit` entries — the
 * most recent activity is the most likely to be relevant to a bug just
 * reported. */
function mostRecent<T extends { timestamp: number }>(entries: T[], limit: number): { kept: T[]; omitted: number } {
  const sorted = [...entries].sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length <= limit) return { kept: sorted, omitted: 0 };
  return { kept: sorted.slice(sorted.length - limit), omitted: sorted.length - limit };
}

/**
 * Assembles the final combined plain-text description: the reporter's own
 * words, unmodified, first — followed by a clearly-delimited structured
 * metadata block built only from sections that actually have data.
 *
 * If NO metadata is available at all (no environment, no element, no
 * console/network entries), the reporter's text is returned unchanged —
 * no empty/misleading metadata block is ever appended.
 */
export function buildTaskDescription(input: BuildDescriptionInput): string {
  const reporterText = input.reporterText ?? "";
  const sections: string[] = [];

  if (input.environment) {
    const env = input.environment;
    sections.push(
      [
        "Environment:",
        `  URL: ${env.pageUrl}`,
        `  Browser: ${env.browserName} ${env.browserVersion}`,
        `  OS: ${env.os}`,
        `  Viewport: ${env.viewportWidth} x ${env.viewportHeight} px`,
        `  Device pixel ratio: ${env.devicePixelRatio}`,
      ].join("\n"),
    );
  }

  if (input.element) {
    sections.push(["Picked element:", `  Selector: ${input.element.selector}`].join("\n"));
  }

  const consoleEntries = input.consoleEntries ?? [];
  if (consoleEntries.length > 0) {
    const { kept, omitted } = mostRecent(consoleEntries, MAX_CONSOLE_ENTRIES_IN_DESCRIPTION);
    const lines = ["Console errors/warnings (most recent first):"];
    // Most-recent-first for readability in the rendered excerpt.
    for (const entry of [...kept].reverse()) {
      lines.push(formatConsoleEntry(entry));
    }
    if (omitted > 0) {
      lines.push(`... and ${omitted} more console entries not shown`);
    }
    sections.push(lines.join("\n"));
  }

  const networkEntries = input.networkEntries ?? [];
  if (networkEntries.length > 0) {
    const { kept, omitted } = mostRecent(networkEntries, MAX_NETWORK_ENTRIES_IN_DESCRIPTION);
    const lines = ["Failed network requests (most recent first):"];
    for (const entry of [...kept].reverse()) {
      lines.push(formatNetworkEntry(entry));
    }
    if (omitted > 0) {
      lines.push(`... and ${omitted} more network entries not shown`);
    }
    sections.push(lines.join("\n"));
  }

  if (sections.length === 0) {
    return reporterText;
  }

  return [reporterText, SEPARATOR, METADATA_HEADING, "", sections.join("\n\n")].join("\n\n");
}
