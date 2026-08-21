"use client";

// F141 (AS-248): actor + action-type filters for the workspace audit log,
// written into the URL's query string the same way `components/task/
// list-filters.tsx` (F054) does — a thin Client Component that only owns
// the interactive Selects; the audit page itself stays a Server Component
// reading `searchParams` and re-fetching via `getAuditLogPage`. Changing
// either filter also resets any "load more" window back to the default
// page size (deleting `limit`) so a new filter combination starts from
// its own first bounded page rather than keeping a stale, unrelated
// window size.

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/user-avatar";

const ALL_VALUE = "__all__";

export type AuditActorOption = {
  id: string;
  label: string;
  avatarUrl?: string | null;
};

export type AuditActionOption = {
  value: string;
  label: string;
};

export function AuditFilters({
  actorOptions,
  actionOptions,
}: {
  actorOptions: AuditActorOption[];
  actionOptions: AuditActionOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const actorId = searchParams.get("actorId") ?? ALL_VALUE;
  const action = searchParams.get("action") ?? ALL_VALUE;
  const hasActiveFilters = actorId !== ALL_VALUE || action !== ALL_VALUE;

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ALL_VALUE) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // A new filter starts a fresh bounded window.
      params.delete("limit");
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname);
    },
    [pathname, router, searchParams],
  );

  const clearFilters = useCallback(() => {
    router.push(pathname);
  }, [pathname, router]);

  const actorLabels: Record<string, string> = { [ALL_VALUE]: "All actors" };
  const actorAvatarUrls: Record<string, string | null> = {};
  for (const option of actorOptions) {
    actorLabels[option.id] = option.label;
    actorAvatarUrls[option.id] = option.avatarUrl ?? null;
  }

  const actionLabels: Record<string, string> = { [ALL_VALUE]: "All actions" };
  for (const option of actionOptions) {
    actionLabels[option.value] = option.label;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={actorId} onValueChange={(value) => setParam("actorId", value)}>
        <SelectTrigger size="sm" className="w-44" aria-label="Filter by actor">
          <SelectValue placeholder="Actor">
            {(value: string) => (
              <span className="flex items-center gap-2">
                {value !== ALL_VALUE && (
                  <UserAvatar
                    person={{
                      id: value,
                      name: actorLabels[value] ?? value,
                      avatarUrl: actorAvatarUrls[value] ?? null,
                    }}
                    size="sm"
                  />
                )}
                {actorLabels[value] ?? value}
              </span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>All actors</SelectItem>
          {actorOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              <span className="flex items-center gap-2">
                <UserAvatar
                  person={{
                    id: option.id,
                    name: option.label,
                    avatarUrl: option.avatarUrl,
                  }}
                  size="sm"
                />
                {option.label}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={action} onValueChange={(value) => setParam("action", value)}>
        <SelectTrigger size="sm" className="w-48" aria-label="Filter by action type">
          <SelectValue placeholder="Action">
            {(value: string) => actionLabels[value] ?? value}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_VALUE}>All actions</SelectItem>
          {actionOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasActiveFilters && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clearFilters}
          aria-label="Clear filters"
        >
          <X className="size-3.5" aria-hidden="true" />
          Clear filters
        </Button>
      )}
    </div>
  );
}
