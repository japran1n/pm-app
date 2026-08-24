// F229 (AS-429, AS-432, AS-433): read paths for the saved-view UI. Both
// functions use the caller's own session-scoped client (`createClient()`),
// never the admin client -- `saved_views`' SELECT RLS policy (F227,
// supabase/migrations/20260826010000_create_saved_views.sql) is already
// the real, unbypassable visibility boundary for AS-429 ("a shared view is
// visible to every member with access to its project") and AS-434 ("a
// personal view is not visible to other members, including via a direct
// query") -- this file adds no parallel authorization logic of its own,
// it just shapes the RLS-scoped rows for the UI.

import { createClient } from "@/lib/supabase/server";
import type { SavedViewConfig, SavedViewScope, SavedViewType } from "@/lib/validation/views";

export type SavedViewListItem = {
  id: string;
  ownerId: string;
  name: string;
  scope: SavedViewScope;
  viewType: SavedViewType;
  config: SavedViewConfig;
  isDefault: boolean;
  isMine: boolean;
};

// AS-429: lists every saved view visible to the caller for this project
// (their own personal + shared views, and every OTHER member's shared
// view) -- RLS does the actual filtering; this just resolves `isMine` for
// the UI to group "Your views" vs "Shared with you".
export async function listSavedViewsForProject(
  projectId: string,
  viewType: SavedViewType = "list",
): Promise<SavedViewListItem[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("saved_views")
    .select("id, owner_id, name, scope, view_type, config, is_default")
    .eq("project_id", projectId)
    .eq("view_type", viewType)
    .order("name", { ascending: true });

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    scope: row.scope as SavedViewScope,
    viewType: row.view_type as SavedViewType,
    config: row.config as SavedViewConfig,
    isDefault: row.is_default,
    isMine: row.owner_id === user.id,
  }));
}

// AS-431's read-side counterpart: the caller's own default view for this
// project (is_default is scoped per owner_id -- see F227's unique index --
// so this can never resolve to someone else's default, RLS or no RLS).
export async function getMyDefaultSavedView(
  projectId: string,
  viewType: SavedViewType = "list",
): Promise<{ id: string } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from("saved_views")
    .select("id")
    .eq("project_id", projectId)
    .eq("view_type", viewType)
    .eq("owner_id", user.id)
    .eq("is_default", true)
    .maybeSingle();

  if (error || !data) return null;
  return { id: data.id };
}
