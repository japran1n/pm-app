import { z } from "zod";

// F208: validates markNotificationRead input (AS-386). Mirrors the
// file-layout convention established by lib/validation/watchers.ts.
// markAllNotificationsRead takes no input (it's scoped to the caller's
// own session + the active workspace id, both resolved server-side), so
// it has no matching schema here.
export const markNotificationReadSchema = z.object({
  notificationId: z.string().uuid("Invalid notification."),
});

export type MarkNotificationReadInput = z.infer<
  typeof markNotificationReadSchema
>;

export const markAllNotificationsReadSchema = z.object({
  workspaceId: z.string().uuid("Invalid workspace."),
});

export type MarkAllNotificationsReadInput = z.infer<
  typeof markAllNotificationsReadSchema
>;
