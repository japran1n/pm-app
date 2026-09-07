"use client";

// Follow-up (advanced filtering, partial -> UI): a filter-builder for a
// saved view's `config.filters` (lib/validation/views.ts's
// savedViewFilterSchema). Lets a user add/remove `{ field, operator, value }`
// conditions and, for `status`/`priority`/`assigneeId`, choose EITHER a
// single value ("is") or several ("is any of" -- the `operator: "in"`
// multi-select lib/views/resolve-view.ts already knows how to evaluate,
// added in the prior pass with no UI). All conditions are implicitly
// AND-ed together, matching how `resolveListViewFilters` already combines
// them (one JS object with one key per field) -- there is no group/OR
// support yet; see this component's own follow-up note below for why.
//
// Full AND/OR nested condition GROUPS were explicitly deprioritized for
// this pass (see this feature's mission handoff): `resolveListViewFilters`
// and `getProjectListTasks` only understand one flat set of per-field
// filters ANDed together, so a group-aware builder here would produce a
// config shape neither reader can evaluate. Building the reader-side
// recursive evaluator plus this builder's group UI in the same pass was
// out of budget; this component intentionally stays a flat
// field/operator/value list (still a real improvement: it adds the
// multi-select "in" UI that had no UI at all before) rather than shipping
// a group UI that would silently do nothing.
//
// Backward compatible by construction: it reads/writes the exact same
// `SavedViewConfig["filters"]` shape older views already have (a flat
// array of `{ field, operator, value }`) -- an existing view saved before
// this component existed (single-value "eq" entries) loads here exactly as
// a one-value "is" condition per field, no migration needed.

import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SavedViewConfig } from "@/lib/validation/views";

export type FilterableField = "status" | "priority" | "assigneeId";

export type FilterFieldOption = {
  field: FilterableField;
  label: string;
  values: { value: string; label: string }[];
};

type Filter = SavedViewConfig["filters"][number];

const FIELD_LABELS: Record<FilterableField, string> = {
  status: "Status",
  priority: "Priority",
  assigneeId: "Assignee",
};

function valuesOf(filter: Filter): string[] {
  if (filter.operator === "in") {
    return Array.isArray(filter.value) ? filter.value.map((v) => String(v)) : [];
  }
  return filter.value != null ? [String(filter.value)] : [];
}

export function FilterBuilder({
  filters,
  onChange,
  fieldOptions,
}: {
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  /** The fields this project can filter on and each field's valid values
   * (e.g. the project's real status columns, or its active members) --
   * caller-supplied so this component never has to fetch anything itself. */
  fieldOptions: FilterFieldOption[];
}) {
  function updateFilter(index: number, next: Filter) {
    const copy = filters.slice();
    copy[index] = next;
    onChange(copy);
  }

  function removeFilter(index: number) {
    onChange(filters.filter((_, i) => i !== index));
  }

  function addFilter() {
    const first = fieldOptions[0];
    if (!first) return;
    onChange([
      ...filters,
      { field: first.field, operator: "eq", value: first.values[0]?.value ?? "" },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      {filters.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No conditions yet. Every condition added below must match (AND).
        </p>
      )}
      {filters.map((filter, index) => {
        const option = fieldOptions.find((o) => o.field === filter.field);
        const selectedValues = new Set(valuesOf(filter));

        return (
          <div key={index} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center gap-2">
              <Select
                value={filter.field}
                onValueChange={(field) => {
                  if (!field) return;
                  const nextOption = fieldOptions.find((o) => o.field === field);
                  updateFilter(index, {
                    field,
                    operator: "eq",
                    value: nextOption?.values[0]?.value ?? "",
                  });
                }}
              >
                <SelectTrigger className="w-36" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {fieldOptions.map((o) => (
                    <SelectItem key={o.field} value={o.field}>
                      {o.label ?? FIELD_LABELS[o.field]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filter.operator}
                onValueChange={(operator) => {
                  if (!operator) return;
                  if (operator === "in") {
                    updateFilter(index, { field: filter.field, operator, value: valuesOf(filter) });
                  } else {
                    updateFilter(index, {
                      field: filter.field,
                      operator,
                      value: valuesOf(filter)[0] ?? "",
                    });
                  }
                }}
              >
                <SelectTrigger className="w-32" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eq">is</SelectItem>
                  <SelectItem value="in">is any of</SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="ml-auto size-7 shrink-0"
                aria-label="Remove condition"
                onClick={() => removeFilter(index)}
              >
                <X className="size-3.5" aria-hidden="true" />
              </Button>
            </div>

            {filter.operator === "in" ? (
              <div className="flex flex-wrap gap-3">
                {(option?.values ?? []).map((v) => (
                  <label key={v.value} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={selectedValues.has(v.value)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedValues);
                        if (checked) next.add(v.value);
                        else next.delete(v.value);
                        updateFilter(index, {
                          field: filter.field,
                          operator: "in",
                          value: Array.from(next),
                        });
                      }}
                    />
                    {v.label}
                  </label>
                ))}
              </div>
            ) : (
              <Select
                value={valuesOf(filter)[0] ?? ""}
                onValueChange={(value) =>
                  updateFilter(index, { field: filter.field, operator: "eq", value })
                }
              >
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue placeholder="Choose a value" />
                </SelectTrigger>
                <SelectContent>
                  {(option?.values ?? []).map((v) => (
                    <SelectItem key={v.value} value={v.value}>
                      {v.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      })}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={addFilter}
        disabled={fieldOptions.length === 0}
      >
        Add condition
      </Button>
    </div>
  );
}
