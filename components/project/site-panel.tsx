"use client";

// F022 (missions/20260903-portal): the "Site" panel — Links · Accounts,
// one project settings tab, two inline-editable, position-ordered
// tables. Mirrors components/project/record-panel.tsx's shape exactly:
// Server Component page fetches both lists and passes them down as typed
// props; this is the only Client Component. Inline add, inline
// edit-on-blur, a `client_visible` toggle per row, up/down reorder
// buttons (same shape as `reorderPhases`/`reorderColumn` — no drag
// library in this codebase's project-settings surfaces).
//
// `canManage` only controls whether the mutating controls render — a
// UI convenience, not the security boundary; every action in
// lib/actions/project-site.ts independently re-checks via withAuthz's
// default `canWrite` gate plus RLS.

import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createProjectAccount,
  createProjectLink,
  deleteProjectAccount,
  deleteProjectLink,
  reorderProjectAccount,
  reorderProjectLink,
  restoreProjectAccount,
  restoreProjectLink,
  updateProjectAccount,
  updateProjectLink,
} from "@/lib/actions/project-site";
import { showUndoToast } from "@/lib/toast/undo-toast";
import type {
  ProjectAccount,
  ProjectAccountOwner,
  ProjectAccountStatus,
  ProjectLink,
  ProjectLinkKind,
} from "@/lib/queries/project-site";
import {
  projectAccountOwnerSchema,
  projectAccountStatusSchema,
  projectLinkKindSchema,
} from "@/lib/validation/project-site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const LINK_KIND_LABELS: Record<ProjectLinkKind, string> = {
  staging: "Staging",
  live: "Live",
  figma: "Figma",
  sitemap: "Sitemap",
  drive: "Drive",
  webflow: "Webflow",
  gtm: "GTM",
  analytics: "Analytics",
  search_console: "Search Console",
  other: "Other",
};

const ACCOUNT_OWNER_LABELS: Record<ProjectAccountOwner, string> = {
  client: "Client",
  agency: "Agency",
};

const ACCOUNT_STATUS_LABELS: Record<ProjectAccountStatus, string> = {
  pending: "Pending",
  provisioned: "Provisioned",
  transferred: "Transferred",
};

function DeleteRowButton({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [isDeleting, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={isDeleting}
            aria-label={`Delete ${label}`}
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{label}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes it from the project and the client portal. You can undo this
            for a few seconds right after deleting.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => startTransition(onConfirm)}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReorderButtons({
  disabled,
  onMoveUp,
  onMoveDown,
}: {
  disabled: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <div className="flex flex-col">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-6"
        disabled={disabled}
        aria-label="Move up"
        onClick={onMoveUp}
      >
        <ArrowUp className="h-3 w-3" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-5 w-6"
        disabled={disabled}
        aria-label="Move down"
        onClick={onMoveDown}
      >
        <ArrowDown className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------
// Links tab
// ---------------------------------------------------------------------

function LinkRow({
  link,
  onChanged,
  onRemoved,
  onRestored,
  onMove,
  isReordering,
}: {
  link: ProjectLink;
  onChanged: (link: ProjectLink) => void;
  onRemoved: (id: string) => void;
  onRestored: (link: ProjectLink) => void;
  onMove: (direction: "up" | "down") => void;
  isReordering: boolean;
}) {
  const [kind, setKind] = useState<ProjectLinkKind>(link.kind);
  const [label, setLabel] = useState(link.label);
  const [url, setUrl] = useState(link.url);
  const [clientVisible, setClientVisible] = useState(link.clientVisible);
  const [isPending, startTransition] = useTransition();

  function submit(next: {
    kind: ProjectLinkKind;
    label: string;
    url: string;
    clientVisible: boolean;
  }) {
    startTransition(async () => {
      const result = await updateProjectLink({ linkId: link.id, ...next });
      if (!result.ok) {
        setKind(link.kind);
        setLabel(link.label);
        setUrl(link.url);
        setClientVisible(link.clientVisible);
        toast.error(result.error);
        return;
      }
      onChanged(result.data);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
      <ReorderButtons
        disabled={isReordering}
        onMoveUp={() => onMove("up")}
        onMoveDown={() => onMove("down")}
      />
      <Select
        value={kind}
        onValueChange={(value) => {
          const next = value as ProjectLinkKind;
          setKind(next);
          submit({ kind: next, label, url, clientVisible });
        }}
        disabled={isPending}
      >
        <SelectTrigger className="w-36" aria-label="Link kind">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {projectLinkKindSchema.options.map((value) => (
            <SelectItem key={value} value={value}>
              {LINK_KIND_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => label.trim() && label !== link.label && submit({ kind, label, url, clientVisible })}
        disabled={isPending}
        className="w-40"
        aria-label="Link label"
      />
      <Input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onBlur={() => url.trim() && url !== link.url && submit({ kind, label, url, clientVisible })}
        disabled={isPending}
        className="w-64"
        aria-label="Link URL"
      />
      <div className="ml-auto flex items-center gap-2">
        <Switch
          checked={clientVisible}
          onCheckedChange={(checked) => {
            setClientVisible(checked);
            submit({ kind, label, url, clientVisible: checked });
          }}
          disabled={isPending}
          aria-label={`${link.label} visible to client`}
        />
        <span className="text-xs text-muted-foreground">
          {clientVisible ? "Visible to client" : "Internal only"}
        </span>
        <DeleteRowButton
          label={link.label}
          onConfirm={async () => {
            const result = await deleteProjectLink(link.id);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            onRemoved(link.id);
            showUndoToast({
              message: "Link deleted.",
              description: "This can't be recovered once this undo window closes.",
              onUndo: async () => {
                const restoreResult = await restoreProjectLink(result.data.restore);
                if (!restoreResult.ok) {
                  toast.error(restoreResult.error);
                  return;
                }
                onRestored(restoreResult.data);
              },
            });
          }}
        />
      </div>
    </div>
  );
}

function LinksTab({
  projectId,
  initialLinks,
  canManage,
}: {
  projectId: string;
  initialLinks: ProjectLink[];
  canManage: boolean;
}) {
  const [links, setLinks] = useState([...initialLinks].sort((a, b) => a.position - b.position));
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newKind, setNewKind] = useState<ProjectLinkKind>("staging");
  const [isAdding, startAddTransition] = useTransition();
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  // Same shape as components/project/phase-list.tsx's own reorder
  // handler: optimistic local swap, server call is authoritative and
  // reconciles this if it disagrees or fails.
  function handleMove(linkId: string, direction: "up" | "down") {
    const index = links.findIndex((l) => l.id === linkId);
    if (index === -1) return;
    const neighborIndex = direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= links.length) return;

    const previous = links;
    const moved = links[index];
    const neighbor = links[neighborIndex];

    setLinks((current) =>
      current
        .map((l) => {
          if (l.id === moved.id) return { ...l, position: neighbor.position };
          if (l.id === neighbor.id) return { ...l, position: moved.position };
          return l;
        })
        .sort((a, b) => a.position - b.position),
    );

    setReorderingId(linkId);
    (async () => {
      const result = await reorderProjectLink(linkId, direction);
      setReorderingId(null);
      if (!result.ok) {
        setLinks(previous);
        toast.error(result.error);
        return;
      }
      if (result.data.swappedWith) {
        setLinks((current) =>
          current
            .map((l) => {
              if (l.id === result.data.moved.id) return { ...l, position: result.data.moved.position };
              if (l.id === result.data.swappedWith!.id)
                return { ...l, position: result.data.swappedWith!.position };
              return l;
            })
            .sort((a, b) => a.position - b.position),
        );
      }
    })();
  }

  function handleAdd() {
    if (!newLabel.trim() || !newUrl.trim()) {
      toast.error("Label and URL are required.");
      return;
    }
    startAddTransition(async () => {
      const result = await createProjectLink({
        projectId,
        kind: newKind,
        label: newLabel,
        url: newUrl,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLinks((current) => [...current, result.data].sort((a, b) => a.position - b.position));
      setNewLabel("");
      setNewUrl("");
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="links-tab">
      <div className="flex flex-col gap-2">
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">No links yet.</p>
        ) : (
          links.map((link) =>
            canManage ? (
              <LinkRow
                key={link.id}
                link={link}
                onChanged={(next) =>
                  setLinks((current) =>
                    current
                      .map((l) => (l.id === next.id ? next : l))
                      .sort((a, b) => a.position - b.position),
                  )
                }
                onRemoved={(id) => setLinks((current) => current.filter((l) => l.id !== id))}
                onRestored={(restored) =>
                  setLinks((current) =>
                    [...current.filter((l) => l.id !== restored.id), restored].sort(
                      (a, b) => a.position - b.position,
                    ),
                  )
                }
                onMove={(direction) => handleMove(link.id, direction)}
                isReordering={reorderingId === link.id}
              />
            ) : (
              <div key={link.id} className="rounded-md border border-border p-3 text-sm">
                {link.label} — {LINK_KIND_LABELS[link.kind]}
              </div>
            ),
          )
        )}
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
          <Select value={newKind} onValueChange={(value) => setNewKind(value as ProjectLinkKind)}>
            <SelectTrigger className="w-36" aria-label="New link kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projectLinkKindSchema.options.map((value) => (
                <SelectItem key={value} value={value}>
                  {LINK_KIND_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label htmlFor="new-link-label" className="sr-only">
            New link label
          </Label>
          <Input
            id="new-link-label"
            placeholder="Label"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            disabled={isAdding}
            className="w-40"
          />
          <Label htmlFor="new-link-url" className="sr-only">
            New link URL
          </Label>
          <Input
            id="new-link-url"
            placeholder="https://…"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            disabled={isAdding}
            className="w-64"
          />
          <Button type="button" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add link"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Accounts tab
// ---------------------------------------------------------------------

function AccountRow({
  account,
  onChanged,
  onRemoved,
  onRestored,
  onMove,
  isReordering,
}: {
  account: ProjectAccount;
  onChanged: (account: ProjectAccount) => void;
  onRemoved: (id: string) => void;
  onRestored: (account: ProjectAccount) => void;
  onMove: (direction: "up" | "down") => void;
  isReordering: boolean;
}) {
  const [service, setService] = useState(account.service);
  const [owner, setOwner] = useState<ProjectAccountOwner>(account.owner);
  const [status, setStatus] = useState<ProjectAccountStatus>(account.status);
  const [note, setNote] = useState(account.note ?? "");
  const [clientVisible, setClientVisible] = useState(account.clientVisible);
  const [isPending, startTransition] = useTransition();

  function submit(next: {
    service: string;
    owner: ProjectAccountOwner;
    status: ProjectAccountStatus;
    note: string;
    clientVisible: boolean;
  }) {
    startTransition(async () => {
      const result = await updateProjectAccount({
        accountId: account.id,
        service: next.service,
        owner: next.owner,
        status: next.status,
        renewalDate: account.renewalDate,
        note: next.note || null,
        clientVisible: next.clientVisible,
      });
      if (!result.ok) {
        setService(account.service);
        setOwner(account.owner);
        setStatus(account.status);
        setNote(account.note ?? "");
        setClientVisible(account.clientVisible);
        toast.error(result.error);
        return;
      }
      onChanged(result.data);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
      <ReorderButtons
        disabled={isReordering}
        onMoveUp={() => onMove("up")}
        onMoveDown={() => onMove("down")}
      />
      <Input
        value={service}
        onChange={(e) => setService(e.target.value)}
        onBlur={() =>
          service.trim() &&
          service !== account.service &&
          submit({ service, owner, status, note, clientVisible })
        }
        disabled={isPending}
        className="w-40"
        aria-label="Account service"
      />
      <Select
        value={owner}
        onValueChange={(value) => {
          const next = value as ProjectAccountOwner;
          setOwner(next);
          submit({ service, owner: next, status, note, clientVisible });
        }}
        disabled={isPending}
      >
        <SelectTrigger className="w-28" aria-label="Account owner">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {projectAccountOwnerSchema.options.map((value) => (
            <SelectItem key={value} value={value}>
              {ACCOUNT_OWNER_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={status}
        onValueChange={(value) => {
          const next = value as ProjectAccountStatus;
          setStatus(next);
          submit({ service, owner, status: next, note, clientVisible });
        }}
        disabled={isPending}
      >
        <SelectTrigger className="w-36" aria-label="Account status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {projectAccountStatusSchema.options.map((value) => (
            <SelectItem key={value} value={value}>
              {ACCOUNT_STATUS_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => submit({ service, owner, status, note, clientVisible })}
        disabled={isPending}
        placeholder="Note — never a password"
        className="w-56"
        aria-label={`${account.service} note`}
      />
      <div className="ml-auto flex items-center gap-2">
        <Switch
          checked={clientVisible}
          onCheckedChange={(checked) => {
            setClientVisible(checked);
            submit({ service, owner, status, note, clientVisible: checked });
          }}
          disabled={isPending}
          aria-label={`${account.service} visible to client`}
        />
        <span className="text-xs text-muted-foreground">
          {clientVisible ? "Visible to client" : "Internal only"}
        </span>
        <DeleteRowButton
          label={account.service}
          onConfirm={async () => {
            const result = await deleteProjectAccount(account.id);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            onRemoved(account.id);
            showUndoToast({
              message: "Account deleted.",
              description: "This can't be recovered once this undo window closes.",
              onUndo: async () => {
                const restoreResult = await restoreProjectAccount(result.data.restore);
                if (!restoreResult.ok) {
                  toast.error(restoreResult.error);
                  return;
                }
                onRestored(restoreResult.data);
              },
            });
          }}
        />
      </div>
    </div>
  );
}

function AccountsTab({
  projectId,
  initialAccounts,
  canManage,
}: {
  projectId: string;
  initialAccounts: ProjectAccount[];
  canManage: boolean;
}) {
  const [accounts, setAccounts] = useState(
    [...initialAccounts].sort((a, b) => a.position - b.position),
  );
  const [newService, setNewService] = useState("");
  const [isAdding, startAddTransition] = useTransition();
  const [reorderingId, setReorderingId] = useState<string | null>(null);

  function handleMove(accountId: string, direction: "up" | "down") {
    const index = accounts.findIndex((a) => a.id === accountId);
    if (index === -1) return;
    const neighborIndex = direction === "up" ? index - 1 : index + 1;
    if (neighborIndex < 0 || neighborIndex >= accounts.length) return;

    const previous = accounts;
    const moved = accounts[index];
    const neighbor = accounts[neighborIndex];

    setAccounts((current) =>
      current
        .map((a) => {
          if (a.id === moved.id) return { ...a, position: neighbor.position };
          if (a.id === neighbor.id) return { ...a, position: moved.position };
          return a;
        })
        .sort((a, b) => a.position - b.position),
    );

    setReorderingId(accountId);
    (async () => {
      const result = await reorderProjectAccount(accountId, direction);
      setReorderingId(null);
      if (!result.ok) {
        setAccounts(previous);
        toast.error(result.error);
        return;
      }
      if (result.data.swappedWith) {
        setAccounts((current) =>
          current
            .map((a) => {
              if (a.id === result.data.moved.id) return { ...a, position: result.data.moved.position };
              if (a.id === result.data.swappedWith!.id)
                return { ...a, position: result.data.swappedWith!.position };
              return a;
            })
            .sort((a, b) => a.position - b.position),
        );
      }
    })();
  }

  function handleAdd() {
    if (!newService.trim()) {
      toast.error("Service name is required.");
      return;
    }
    startAddTransition(async () => {
      const result = await createProjectAccount({
        projectId,
        service: newService,
        owner: "agency",
        status: "pending",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAccounts((current) =>
        [...current, result.data].sort((a, b) => a.position - b.position),
      );
      setNewService("");
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="accounts-tab">
      <div className="flex flex-col gap-2">
        {accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No accounts recorded yet.</p>
        ) : (
          accounts.map((account) =>
            canManage ? (
              <AccountRow
                key={account.id}
                account={account}
                onChanged={(next) =>
                  setAccounts((current) =>
                    current
                      .map((a) => (a.id === next.id ? next : a))
                      .sort((a, b) => a.position - b.position),
                  )
                }
                onRemoved={(id) => setAccounts((current) => current.filter((a) => a.id !== id))}
                onRestored={(restored) =>
                  setAccounts((current) =>
                    [...current.filter((a) => a.id !== restored.id), restored].sort(
                      (a, b) => a.position - b.position,
                    ),
                  )
                }
                onMove={(direction) => handleMove(account.id, direction)}
                isReordering={reorderingId === account.id}
              />
            ) : (
              <div key={account.id} className="rounded-md border border-border p-3 text-sm">
                {account.service} — {ACCOUNT_STATUS_LABELS[account.status]}
              </div>
            ),
          )
        )}
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
          <Label htmlFor="new-account-service" className="sr-only">
            New account service
          </Label>
          <Input
            id="new-account-service"
            placeholder="Service (e.g. Domain registrar)"
            value={newService}
            onChange={(e) => setNewService(e.target.value)}
            disabled={isAdding}
            className="w-56"
          />
          <Button type="button" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add account"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// SitePanel
// ---------------------------------------------------------------------

export function SitePanel({
  projectId,
  initialLinks,
  initialAccounts,
  canManage,
}: {
  projectId: string;
  initialLinks: ProjectLink[];
  initialAccounts: ProjectAccount[];
  canManage: boolean;
}) {
  return (
    <Tabs defaultValue="links">
      <TabsList>
        <TabsTrigger value="links">Links</TabsTrigger>
        <TabsTrigger value="accounts">Accounts</TabsTrigger>
      </TabsList>
      <TabsContent value="links">
        <LinksTab projectId={projectId} initialLinks={initialLinks} canManage={canManage} />
      </TabsContent>
      <TabsContent value="accounts">
        <AccountsTab
          projectId={projectId}
          initialAccounts={initialAccounts}
          canManage={canManage}
        />
      </TabsContent>
    </Tabs>
  );
}
