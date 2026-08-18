// F040 (AS-063, AS-064): pure helper shared by TaskCard and any other task
// surface (board, list) that needs to visually distinguish overdue tasks.
//
// A task is overdue when its due date is strictly in the past AND its
// status is not "done" — a completed task is never shown as overdue
// regardless of when it was due (AS-064).
//
// Date-only comparison: `dueDate` is a plain "YYYY-MM-DD" date string (see
// TaskDetailSheet's <input type="date">), not a timestamp, so "past" means
// "before today's calendar date", not "before this exact instant". This
// avoids a task due "today" flipping to overdue partway through the day
// depending on time zone/time of day.

export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate) return false;
  if (status === "done") return false;

  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return false;

  const today = new Date();
  const todayDateOnly = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const dueDateOnly = new Date(
    due.getUTCFullYear(),
    due.getUTCMonth(),
    due.getUTCDate(),
  );

  return dueDateOnly.getTime() < todayDateOnly.getTime();
}
