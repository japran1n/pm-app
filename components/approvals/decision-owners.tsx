"use client";

// F008 section 4: project settings' "Who approves what" section — four
// fixed rows (one per decision type), each picking a client member of the
// project. Reuses components/project/project-members.tsx's picker
// pattern (a Select bound to a Server Action, toast on result) rather than
// a new one, per the spec's own "Reuse components/project-members
// patterns" instruction — components/project/project-members.tsx is this
// repo's actual file for that pattern (there is no
// components/project-members/ directory).

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setDecisionOwner } from "@/lib/actions/approvals";
import type { ApprovalDecisionType, PortalDecisionOwner, ProjectClientMember } from "@/lib/queries/approvals";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DECISION_TYPES: { value: ApprovalDecisionType; label: string; description: string }[] = [
  { value: "content", label: "Content", description: "Copy, sitemap structure, wording." },
  { value: "brand", label: "Brand", description: "Visual design, moodboards, page layouts." },
  { value: "technical", label: "Technical", description: "Integrations, platform, technical scope." },
  { value: "commercial", label: "Commercial", description: "Pricing, change requests, contracts." },
];

const NONE_VALUE = "__none__";

function DecisionOwnerRow({
  projectId,
  decisionType,
  label,
  description,
  ownerId,
  clientMembers,
  disabled,
}: {
  projectId: string;
  decisionType: ApprovalDecisionType;
  label: string;
  description: string;
  ownerId: string | null;
  clientMembers: ProjectClientMember[];
  disabled: boolean;
}) {
  const [value, setValue] = useState(ownerId ?? NONE_VALUE);
  const [isPending, startTransition] = useTransition();

  function handleChange(nextValue: string) {
    const previous = value;
    setValue(nextValue);
    startTransition(async () => {
      const result = await setDecisionOwner(
        projectId,
        decisionType,
        nextValue === NONE_VALUE ? null : nextValue,
      );
      if (!result.ok) {
        setValue(previous);
        toast.error(result.error);
        return;
      }
      toast.success(`${label} decisions: owner updated.`);
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="flex flex-col">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
      <div className="flex items-center gap-2">
        {isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
        <Select
          value={value}
          onValueChange={(nextValue) => {
            if (typeof nextValue === "string") handleChange(nextValue);
          }}
          disabled={disabled || isPending}
        >
          <SelectTrigger id={`decision-owner-${decisionType}`} className="w-56">
            <SelectValue placeholder="No owner set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>No owner</SelectItem>
            {clientMembers.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.name ?? member.email ?? member.userId}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function DecisionOwnersSection({
  projectId,
  owners,
  clientMembers,
  canManage,
}: {
  projectId: string;
  owners: PortalDecisionOwner[];
  clientMembers: ProjectClientMember[];
  canManage: boolean;
}) {
  const ownerByType = new Map(owners.map((owner) => [owner.decisionType, owner.userId]));

  if (clientMembers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This project has no client members yet. Add one from the workspace
        members page, then come back here to say who decides what.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {DECISION_TYPES.map((type) => (
        <DecisionOwnerRow
          key={type.value}
          projectId={projectId}
          decisionType={type.value}
          label={type.label}
          description={type.description}
          ownerId={ownerByType.get(type.value) ?? null}
          clientMembers={clientMembers}
          disabled={!canManage}
        />
      ))}
    </div>
  );
}
