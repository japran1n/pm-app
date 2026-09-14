import { z } from "zod";

// Audit NX-008: input schemas for the search-shaped Server Actions that
// previously took raw strings. These actions are network-addressable, so
// their arguments get the same zod boundary every other action module has
// (lib/validation/<domain>.ts convention). Downstream membership/RLS
// checks are unchanged — this only rejects malformed shapes early.

export const searchInputSchema = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().max(500),
});

export const recentItemPointerSchema = z.object({
  type: z.enum(["project", "task"]),
  id: z.string().uuid(),
  visitedAt: z.number(),
});

export const resolveRecentItemsSchema = z.object({
  workspaceId: z.string().uuid(),
  pointers: z.array(recentItemPointerSchema).max(50),
});
