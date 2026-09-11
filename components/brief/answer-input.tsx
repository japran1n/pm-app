"use client";

// F059 (missions/20260910-182104, AS-119, AS-120, AS-121, AS-122): the
// real per-`answerType` input widgets that replace F057's textarea stub.
//
// AS-119: short_text renders a single-line <input type="text">.
// AS-120: long_text renders a multi-line <textarea>.
// AS-121: single_choice renders a radio group -- exactly one option can
// be selected at a time (native radio semantics enforce this).
// AS-122: multi_choice renders a checkbox group -- more than one option
// can be checked at once (native checkbox semantics allow this).
//
// This component is deliberately "dumb": it derives nothing and owns no
// autosave state itself. It only reflects `value`/`selectedOptions` and
// calls `onChange` with the new (text, options) pair on every edit, so
// the parent (PortalQuestionnaire) stays the single owner of the
// debounced-autosave draft, matching F057's existing autosave wiring.
//
// data-testid="questionnaire-answer-stub" is preserved on the text-type
// inputs (short_text/long_text) specifically so F055's and F057's
// existing tests -- which only exercise short_text questions -- keep
// passing unmodified; this file doesn't change those questions' answer
// shape, just which DOM element renders it.

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import type { BriefQuestion } from "@/lib/queries/brief";

export function AnswerInput({
  question,
  value,
  selectedOptions,
  onChange,
  disabled,
}: {
  question: BriefQuestion;
  value: string | null;
  selectedOptions: string[];
  onChange: (text: string | null, options: string[] | null) => void;
  // F076 (AS-148/AS-149/AS-150): once the brief is approved, every input
  // renders disabled -- the parent (PortalQuestionnaire) passes
  // `brief.state === "approved"` down here so the read-only state is
  // driven by the same brief.state RLS already freezes writes on
  // (20261122040000_f046_brief_rls.sql), not a second parallel flag.
  disabled?: boolean;
}) {
  const options = question.options ?? [];

  if (question.answerType === "short_text") {
    return (
      <Input
        type="text"
        data-testid="questionnaire-answer-stub"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value, null)}
        placeholder="Your answer"
        disabled={disabled}
      />
    );
  }

  if (question.answerType === "long_text") {
    return (
      <Textarea
        data-testid="questionnaire-answer-stub"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value, null)}
        placeholder="Your answer"
        rows={4}
        disabled={disabled}
      />
    );
  }

  if (question.answerType === "single_choice") {
    // AS-121: RadioGroup enforces exactly one selected value at a time --
    // selecting a different option replaces the previous selection rather
    // than adding to it.
    return (
      <RadioGroup
        data-testid="questionnaire-answer-radio-group"
        value={selectedOptions[0] ?? ""}
        onValueChange={(next) => onChange(null, next == null ? [] : [String(next)])}
        disabled={disabled}
      >
        {options.map((option) => (
          <div key={option} className="flex items-center gap-2">
            <RadioGroupItem
              value={option}
              id={`${question.id}-${option}`}
              data-testid={`questionnaire-answer-option-${option}`}
              disabled={disabled}
            />
            <Label htmlFor={`${question.id}-${option}`}>{option}</Label>
          </div>
        ))}
      </RadioGroup>
    );
  }

  // multi_choice -- AS-122: each option is an independent checkbox, so any
  // number greater than one can be checked simultaneously.
  return (
    <div
      className="flex flex-col gap-2"
      data-testid="questionnaire-answer-checkbox-group"
      role="group"
    >
      {options.map((option) => {
        const checked = selectedOptions.includes(option);
        return (
          <div key={option} className="flex items-center gap-2">
            <Checkbox
              checked={checked}
              id={`${question.id}-${option}`}
              data-testid={`questionnaire-answer-option-${option}`}
              disabled={disabled}
              onCheckedChange={(next) => {
                const isChecked = next === true;
                const nextOptions = isChecked
                  ? [...selectedOptions, option]
                  : selectedOptions.filter((o) => o !== option);
                onChange(null, nextOptions);
              }}
            />
            <Label htmlFor={`${question.id}-${option}`}>{option}</Label>
          </div>
        );
      })}
    </div>
  );
}
