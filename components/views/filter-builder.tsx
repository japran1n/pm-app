"use client";

// Follow-up (advanced filtering): a filter-builder for a saved view's
// filter tree (lib/validation/views.ts's `FilterGroup`). Lets a user add
// leaf conditions (`{ field, operator, value }`, same shape/UI as before:
// a single value ("is") or several ("is any of" -- `operator: "in"`)) AND
// nest groups inside groups, each with its own AND/OR combinator toggle --
// the group-aware config `lib/views/resolve-view.ts`'s recursive
// `evaluateFilterGroup` was built to read.
//
// Backward compatible by construction: a caller loads an existing view's
// config through `normalizeFilterGroup`/`resolveEffectiveFilterGroup`
// (lib/validation/views.ts) before handing it to this component, which
// lifts the old flat `{ field, operator, value }[]` shape into the
// trivial `{ combinator: "and", conditions: [...] }` group this component
// natively edits -- an existing view saved before groups existed opens
// here as a single top-level AND group with no nesting, exactly matching
// its old semantics.

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
import type { FilterCondition, FilterGroup } from "@/lib/validation/views";

export type FilterableField = "status" | "priority" | "assigneeId";

export type FilterFieldOption = {
  field: FilterableField;
  label: string;
  values: { value: string; label: string }[];
};

function isGroup(node: FilterCondition | FilterGroup): node is FilterGroup {
  return (node as FilterGroup).combinator !== undefined && Array.isArray((node as FilterGroup).conditions);
}

function valuesOf(filter: FilterCondition): string[] {
  if (filter.operator === "in") {
    return Array.isArray(filter.value) ? filter.value.map((v) => String(v)) : [];
  }
  return filter.value != null ? [String(filter.value)] : [];
}

function emptyGroup(): FilterGroup {
  return { combinator: "and", conditions: [] };
}

function ConditionRow({
  condition,
  fieldOptions,
  onChange,
  onRemove,
}: {
  condition: FilterCondition;
  fieldOptions: FilterFieldOption[];
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
}) {
  const option = fieldOptions.find((o) => o.field === condition.field);
  const selectedValues = new Set(valuesOf(condition));

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Select
          value={condition.field}
          onValueChange={(field) => {
            if (!field) return;
            const nextOption = fieldOptions.find((o) => o.field === field);
            onChange({ field, operator: "eq", value: nextOption?.values[0]?.value ?? "" });
          }}
        >
          <SelectTrigger className="w-36" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fieldOptions.map((o) => (
              <SelectItem key={o.field} value={o.field}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={condition.operator}
          onValueChange={(operator) => {
            if (!operator) return;
            if (operator === "in") {
              onChange({ field: condition.field, operator: "in", value: valuesOf(condition) });
            } else {
              onChange({ field: condition.field, operator: "eq", value: valuesOf(condition)[0] ?? "" });
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
          onClick={onRemove}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>

      {condition.operator === "in" ? (
        <div className="flex flex-wrap gap-3">
          {(option?.values ?? []).map((v) => (
            <label key={v.value} className="flex items-center gap-1.5 text-sm">
              <Checkbox
                checked={selectedValues.has(v.value)}
                onCheckedChange={(checked) => {
                  const next = new Set(selectedValues);
                  if (checked) next.add(v.value);
                  else next.delete(v.value);
                  onChange({ field: condition.field, operator: "in", value: Array.from(next) });
                }}
              />
              {v.label}
            </label>
          ))}
        </div>
      ) : (
        <Select
          value={valuesOf(condition)[0] ?? ""}
          onValueChange={(value) => onChange({ field: condition.field, operator: "eq", value: value ?? "" })}
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
}

// Renders one group's own AND/OR toggle plus every child node (leaf
// conditions and/or nested groups), each child indented one level deeper
// than its parent -- the recursive call at the bottom is what lets a
// group nest inside a group inside a group with no depth limit baked in,
// matching `evaluateFilterGroup`'s own unlimited-depth recursion.
function GroupEditor({
  group,
  fieldOptions,
  onChange,
  onRemove,
  depth,
}: {
  group: FilterGroup;
  fieldOptions: FilterFieldOption[];
  onChange: (next: FilterGroup) => void;
  onRemove?: () => void;
  depth: number;
}) {
  function updateNode(index: number, next: FilterCondition | FilterGroup) {
    const conditions = group.conditions.slice();
    conditions[index] = next;
    onChange({ ...group, conditions });
  }

  function removeNode(index: number) {
    onChange({ ...group, conditions: group.conditions.filter((_, i) => i !== index) });
  }

  function addCondition() {
    const first = fieldOptions[0];
    if (!first) return;
    onChange({
      ...group,
      conditions: [
        ...group.conditions,
        { field: first.field, operator: "eq", value: first.values[0]?.value ?? "" },
      ],
    });
  }

  function addGroup() {
    onChange({ ...group, conditions: [...group.conditions, emptyGroup()] });
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-dashed p-3"
      style={{ marginLeft: depth > 0 ? 16 : 0 }}
      data-testid="filter-group"
      data-depth={depth}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Match</span>
        <Select
          value={group.combinator}
          onValueChange={(combinator) => {
            if (combinator !== "and" && combinator !== "or") return;
            onChange({ ...group, combinator });
          }}
        >
          <SelectTrigger className="w-24" size="sm" aria-label="Group combinator">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">all (AND)</SelectItem>
            <SelectItem value="or">any (OR)</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">of the following</span>

        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="ml-auto size-7 shrink-0"
            aria-label="Remove group"
            onClick={onRemove}
          >
            <X className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      {group.conditions.length === 0 && (
        <p className="text-sm text-muted-foreground">No conditions yet.</p>
      )}

      {group.conditions.map((node, index) =>
        isGroup(node) ? (
          <GroupEditor
            key={index}
            group={node}
            fieldOptions={fieldOptions}
            onChange={(next) => updateNode(index, next)}
            onRemove={() => removeNode(index)}
            depth={depth + 1}
          />
        ) : (
          <ConditionRow
            key={index}
            condition={node}
            fieldOptions={fieldOptions}
            onChange={(next) => updateNode(index, next)}
            onRemove={() => removeNode(index)}
          />
        ),
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={addCondition}
          disabled={fieldOptions.length === 0}
        >
          Add condition
        </Button>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={addGroup}>
          Add group
        </Button>
      </div>
    </div>
  );
}

export function FilterBuilder({
  filterGroup,
  onChange,
  fieldOptions,
}: {
  filterGroup: FilterGroup;
  onChange: (group: FilterGroup) => void;
  /** The fields this project can filter on and each field's valid values
   * (e.g. the project's real status columns, or its active members) --
   * caller-supplied so this component never has to fetch anything itself. */
  fieldOptions: FilterFieldOption[];
}) {
  return (
    <GroupEditor group={filterGroup} fieldOptions={fieldOptions} onChange={onChange} depth={0} />
  );
}
