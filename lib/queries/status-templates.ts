// F428: read-side for workspace status templates. RLS-respecting client —
// `status_templates_select_active_members` already scopes rows to active
// workspace members (20260903010000_status_templates.sql).

import { createClient } from "@/lib/supabase/server";

export type StatusTemplateItem = {
  id: string;
  name: string;
  color: string;
  category: "not_started" | "in_progress" | "done";
  position: number;
};

export type StatusTemplateWithItems = {
  id: string;
  name: string;
  items: StatusTemplateItem[];
};

export async function getStatusTemplates(
  workspaceId: string,
): Promise<StatusTemplateWithItems[]> {
  const supabase = await createClient();

  const { data: templates, error: templatesError } = await supabase
    .from("status_templates")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .order("name");

  if (templatesError) {
    console.error("getStatusTemplates: templates query failed:", templatesError);
    return [];
  }
  if (!templates?.length) return [];

  const { data: items, error: itemsError } = await supabase
    .from("status_template_items")
    .select("id, template_id, name, color, category, position")
    .in(
      "template_id",
      templates.map((t) => t.id),
    )
    .order("position");

  if (itemsError) {
    console.error("getStatusTemplates: items query failed:", itemsError);
  }

  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    items: (items ?? [])
      .filter((item) => item.template_id === template.id)
      .map((item) => ({
        id: item.id,
        name: item.name,
        color: item.color,
        category: item.category as StatusTemplateItem["category"],
        position: item.position,
      })),
  }));
}
