"use client";

// F183 (AS-328/AS-330 UI half, AS-331 UI half): the templates list itself
// — rename/delete controls, gated the same "hidden/disabled + tooltip"
// way every other permission-scoped control in this codebase is (per this
// feature's clarified auth-access answer), via the single shared
// `canManageTemplate` predicate (lib/auth/permissions.ts) so this UI gate
// can never drift from `renameTemplate`/`deleteTemplate`'s own
// creator-or-admin/owner server-side rule (F182).
//
// Client Component only for the interactive rename/delete part — the list
// itself is server-fetched (lib/queries/templates.ts's
// getWorkspaceTaskTemplates) and passed down as a typed prop by the page,
// per this feature's "Server Component for data loading" pattern.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  renameTemplate,
  deleteTemplate,
  setDefaultTemplate,
} from "@/lib/actions/templates";
import { canManageTemplate, type WorkspaceRole } from "@/lib/auth/permissions";
import type { TaskTemplateListItem } from "@/lib/queries/templates";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function TemplateRow({
  template,
  currentUserId,
  currentUserRole,
  workspaceId,
  showDefaultToggle,
}: {
  template: TaskTemplateListItem;
  currentUserId?: string;
  currentUserRole?: WorkspaceRole;
  // F001: only `kind='project'` templates support a default — the
  // caller (TemplateList) decides which list this row belongs to and
  // passes this down rather than this row guessing from its own data.
  workspaceId?: string;
  showDefaultToggle?: boolean;
}) {
  const router = useRouter();
  const [isRenaming, setIsRenaming] = useState(false);
  const [name, setName] = useState(template.name);
  const [isSavingRename, startRenameTransition] = useTransition();
  const [isDeleting, startDeleteTransition] = useTransition();
  const [isTogglingDefault, startDefaultTransition] = useTransition();

  const canManage = currentUserRole
    ? canManageTemplate({
        role: currentUserRole,
        resourceOwnerId: template.createdBy,
        callerId: currentUserId,
      })
    : false;
  const disabledTitle = canManage
    ? undefined
    : "Only the template's creator or a workspace admin can change it.";

  const dateFormatter = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });

  function handleRenameSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Template name is required.");
      return;
    }
    startRenameTransition(async () => {
      const result = await renameTemplate(template.id, trimmed);
      if (result.ok) {
        toast.success("Template renamed.");
        setIsRenaming(false);
        router.refresh();
      } else {
        // Failure handling (clarified spec): revert and surface the
        // server's plain-language error, control stays actionable.
        setName(template.name);
        toast.error(result.error);
      }
    });
  }

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteTemplate(template.id);
      if (result.ok) {
        toast.success("Template deleted.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleToggleDefault() {
    if (!workspaceId) return;
    startDefaultTransition(async () => {
      const result = await setDefaultTemplate(
        workspaceId,
        template.isDefault ? null : template.id,
      );
      if (result.ok) {
        toast.success(
          template.isDefault ? "Default template removed." : "Set as default template.",
        );
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Card className="hover-lift">
      <CardHeader>
        {isRenaming ? (
          <div className="flex items-center gap-2">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={isSavingRename}
              aria-label={`Rename template ${template.name}`}
              className="h-8"
            />
            <Button
              type="button"
              size="sm"
              disabled={isSavingRename}
              onClick={handleRenameSave}
            >
              {isSavingRename ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSavingRename}
              onClick={() => {
                setIsRenaming(false);
                setName(template.name);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <CardTitle className="line-clamp-1">{template.name}</CardTitle>
            {template.isDefault && <Badge variant="secondary">Default</Badge>}
          </div>
        )}
        <CardDescription className="line-clamp-2">
          {template.previewTitle}
          {template.previewDescription ? ` — ${template.previewDescription}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <UserAvatar
            person={{
              id: template.createdBy,
              name: template.creatorName,
              email: template.creatorEmail,
              avatarUrl: template.creatorAvatarUrl,
            }}
            size="sm"
          />
          <span>
            {template.creatorName ?? (
              <span className="font-mono">{template.creatorEmail ?? "Unknown"}</span>
            )}{" "}
            · <span className="font-mono">{dateFormatter.format(new Date(template.createdAt))}</span>
          </span>
        </div>

        {!isRenaming && (
          <div className="flex items-center gap-2">
            {showDefaultToggle && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!canManage || isTogglingDefault}
                title={disabledTitle}
                onClick={handleToggleDefault}
              >
                {isTogglingDefault ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : template.isDefault ? (
                  "Remove default"
                ) : (
                  "Set as default"
                )}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!canManage}
              title={disabledTitle}
              onClick={() => setIsRenaming(true)}
            >
              <Pencil className="size-3.5" aria-hidden="true" />
              Rename
            </Button>

            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canManage || isDeleting}
                    title={disabledTitle}
                  >
                    {isDeleting ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    )}
                    Delete
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &quot;{template.name}&quot;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This only removes the template. Tasks already created
                    from it are not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function TemplateList({
  templates,
  currentUserId,
  currentUserRole,
  workspaceId,
  showDefaultToggle = false,
}: {
  templates: TaskTemplateListItem[];
  currentUserId?: string;
  currentUserRole?: WorkspaceRole;
  // F001: needed by "Set as default"/"Remove default" (setDefaultTemplate
  // takes a workspaceId, not just a templateId, per its own clarified
  // "at most one default per workspace" scoping).
  workspaceId?: string;
  // F001: default toggle only makes sense for `kind='project'` templates
  // (task templates never carry `is_default = true` in practice, per the
  // migration's partial unique index) -- the caller decides per list
  // rather than this component inferring it from `template.isDefault`
  // alone (an all-false list of project templates should still show the
  // toggle to SET one).
  showDefaultToggle?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((template) => (
        <TemplateRow
          key={template.id}
          template={template}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          workspaceId={workspaceId}
          showDefaultToggle={showDefaultToggle}
        />
      ))}
    </div>
  );
}
