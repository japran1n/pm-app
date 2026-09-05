// F116 (missions/20260903-portal): the six system task types' one-line
// definitions, verbatim from docs/task-types.md's own table — a single
// source so the type picker's tooltip and any future surface never
// drifts from the doc. Keyed by `system_key`; a workspace-created custom
// type (system_key null) has no entry here and gets no tooltip.
export const TASK_TYPE_DEFINITIONS: Record<string, string> = {
  page: "One page of the site we deliver — it has a URL.",
  delivery: "Any other agreed-scope work with no URL of its own.",
  qa: "Something we delivered does not work as agreed — our fault. Not billable.",
  client_request: "Client asks for something after delivery, small enough to absorb.",
  change_request: "Client asks for something outside agreed scope — goes to quote.",
  improvement: "Our own idea; nobody asked. Not billable.",
};
