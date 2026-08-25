import { z } from "zod";

// Validates toggleProjectFavorite input (F263: AS-510). Mirrors the
// file-layout convention established by lib/validation/watchers.ts.
export const toggleProjectFavoriteSchema = z.object({
  projectId: z.string().uuid("Invalid project."),
});

export type ToggleProjectFavoriteInput = z.infer<
  typeof toggleProjectFavoriteSchema
>;
