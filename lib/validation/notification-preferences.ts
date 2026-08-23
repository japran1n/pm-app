import { z } from "zod";

// F211 (AS-391, AS-396): validates updateNotificationPreferences input.
// Mirrors lib/validation/profile.ts's pattern — a schema shared by the
// client's immediate-feedback check and the Server Action's authoritative
// server-side check (lib/actions/notification-preferences.ts), per this
// feature's clarified "validation rules" answer: the client check never
// stands alone.
//
// Every field is optional in this schema on purpose: the form
// (components/notifications/preferences-form.tsx) sends a partial patch
// of only the toggle(s) the user actually changed, not the whole row —
// so a concurrent change to a different column by the same user in
// another tab is never clobbered by a stale full-row overwrite.
export const updateNotificationPreferencesSchema = z
  .object({
    mentionInApp: z.boolean(),
    mentionEmail: z.boolean(),
    taskAssignedInApp: z.boolean(),
    taskAssignedEmail: z.boolean(),
    commentReplyInApp: z.boolean(),
    commentReplyEmail: z.boolean(),
    watcherUpdateInApp: z.boolean(),
    watcherUpdateEmail: z.boolean(),
    taskDueSoonInApp: z.boolean(),
    taskDueSoonEmail: z.boolean(),
    emailEnabled: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one preference must be provided.",
  });

export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;
