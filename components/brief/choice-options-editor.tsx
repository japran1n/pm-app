"use client";

// F051 (AS-106): a dynamic list editor for the selectable options of a
// single_choice / multi_choice brief question. Mirrors createQuestionSchema's
// `options: string[] | null` shape from lib/validation/brief.ts -- this
// component only ever hands back a plain string[] to its parent, which is
// responsible for wiring it into the question form's state.

import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChoiceOptionsEditor({
  options,
  onChange,
  disabled,
  idPrefix = "choice-option",
}: {
  options: string[];
  onChange: (options: string[]) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  function updateOption(index: number, value: string) {
    const next = [...options];
    next[index] = value;
    onChange(next);
  }

  function removeOption(index: number) {
    onChange(options.filter((_, optionIndex) => optionIndex !== index));
  }

  function addOption() {
    onChange([...options, ""]);
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Options</Label>
      <div className="flex flex-col gap-2">
        {options.map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              id={`${idPrefix}-${index}`}
              name={`${idPrefix}-${index}`}
              disabled={disabled}
              value={option}
              placeholder={`Option ${index + 1}`}
              onChange={(changeEvent) => updateOption(index, changeEvent.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={disabled}
              aria-label={`Remove option ${index + 1}`}
              onClick={() => removeOption(index)}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={addOption}
        className="self-start"
      >
        <Plus className="size-4" aria-hidden="true" />
        Add option
      </Button>
    </div>
  );
}
