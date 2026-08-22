import { z } from "zod";

// F200: validates toggleReaction input (AS-367). Mirrors the file-layout
// convention established by lib/validation/watchers.ts.
//
// The emoji allow-list mirrors the CHECK constraint added in F199's
// migration (supabase/migrations/20260823010000_create_comment_reactions.sql)
// verbatim -- this is the app-layer half of the "Zod at the action
// boundary ... then the database constraints as the final gate" validation
// answer, so an invalid emoji is rejected with a friendly message before
// ever reaching Postgres, rather than surfacing a raw CHECK-violation
// error to the user.
export const REACTION_EMOJI_ALLOWLIST = [
  "👍",
  "❤️",
  "😄",
  "🎉",
  "👀",
  "🚀",
] as const;

export type ReactionEmoji = (typeof REACTION_EMOJI_ALLOWLIST)[number];

export const toggleReactionSchema = z.object({
  commentId: z.string().uuid("Invalid comment."),
  emoji: z.enum(REACTION_EMOJI_ALLOWLIST, {
    message: "That emoji isn't available for reactions.",
  }),
});

export type ToggleReactionInput = z.infer<typeof toggleReactionSchema>;
