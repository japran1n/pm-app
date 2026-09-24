// F251 (AS-488, AS-489): the project List view's Realtime `tasks` reducer.
//
// The List view and the board render the same `TaskCardTask` shape and
// consume the same `tasks`-table event, so they share ONE merge-don't-
// replace reconciler (lib/board/reconcile-realtime-task.ts). This module
// only keeps the List-view name its callers import.

export { reconcileTask as reconcileListTask } from "@/lib/board/reconcile-realtime-task";
