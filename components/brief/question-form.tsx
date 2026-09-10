"use client";

// F050 (AS-102, AS-103, AS-104, AS-105): the question attribute editor for
// the brief questionnaire builder. Covers create and edit in one
// component, following components/edit-project-dialog.tsx's
// controlled-form + startTransition + server-action-result pattern, and
// components/member-role-select.tsx's <Select> usage for the enum field.
//
// AS-112 (prompt required, non-empty) is re-validated here client-side
// via createQuestionSchema / updateQuestionSchema (the same schemas the
// server actions run) so a bad submission never round-trips to the
// server just to bounce back -- errors are shown inline per-field.

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  createBriefQuestion,
  updateBriefQuestion,
  type BriefQuestionResult,
} from "@/lib/actions/brief";
import {
  createQuestionSchema,
  updateQuestionSchema,
  type CreateQuestionInput,
} from "@/lib/validation/brief";
import type { BriefQuestion, BriefQuestionAnswerType } from "@/lib/queries/brief";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ANSWER_TYPE_LABEL: Record<BriefQuestionAnswerType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  single_choice: "Single choice",
  multi_choice: "Multi choice",
};

const ANSWER_TYPES = Object.keys(ANSWER_TYPE_LABEL) as BriefQuestionAnswerType[];

function isAnswerType(value: string): value is BriefQuestionAnswerType {
  return (ANSWER_TYPES as string[]).includes(value);
}

type QuestionFormValues = {
  prompt: string;
  category: string;
  answerType: BriefQuestionAnswerType;
  helpText: string;
  required: boolean;
};

function emptyValues(): QuestionFormValues {
  return {
    prompt: "",
    category: "",
    answerType: "short_text",
    helpText: "",
    required: false,
  };
}

function valuesFromQuestion(question: BriefQuestion): QuestionFormValues {
  return {
    prompt: question.prompt,
    category: question.category ?? "",
    answerType: question.answerType,
    helpText: question.helpText ?? "",
    required: question.required,
  };
}

export function QuestionForm({
  projectId,
  question,
  onSaved,
  onCancel,
}: {
  projectId: string;
  // Omit `question` for create mode; pass it for edit mode.
  question?: BriefQuestion;
  onSaved?: (question: BriefQuestionResult extends { ok: true; data: infer D } ? D : never) => void;
  onCancel?: () => void;
}) {
  const isEdit = !!question;
  const [values, setValues] = useState<QuestionFormValues>(
    question ? valuesFromQuestion(question) : emptyValues(),
  );
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof QuestionFormValues, string>>>(
    {},
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update<K extends keyof QuestionFormValues>(key: K, value: QuestionFormValues[K]) {
    setValues((previous) => ({ ...previous, [key]: value }));
  }

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const input: CreateQuestionInput = {
      prompt: values.prompt,
      category: values.category,
      answerType: values.answerType,
      helpText: values.helpText || null,
      required: values.required,
    };

    const schema = isEdit ? updateQuestionSchema : createQuestionSchema;
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const nextFieldErrors: Partial<Record<keyof QuestionFormValues, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === "string" && key in values && !(key in nextFieldErrors)) {
          nextFieldErrors[key as keyof QuestionFormValues] = issue.message;
        }
      }
      setFieldErrors(nextFieldErrors);
      setFormError(parsed.error.issues[0]?.message ?? "Invalid question.");
      return;
    }

    startTransition(async () => {
      const result = isEdit
        ? await updateBriefQuestion(question!.id, parsed.data)
        : await createBriefQuestion(projectId, parsed.data as CreateQuestionInput);

      if (result.ok) {
        toast.success(isEdit ? "Question updated." : "Question added.");
        if (!isEdit) setValues(emptyValues());
        onSaved?.(result.data as never);
      } else {
        setFormError(result.error);
        toast.error(result.error);
      }
    });
  }

  const formId = question?.id ?? "new";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`question-prompt-${formId}`}>Question</Label>
        <Input
          id={`question-prompt-${formId}`}
          name="prompt"
          disabled={isPending}
          value={values.prompt}
          onChange={(changeEvent) => update("prompt", changeEvent.target.value)}
          aria-invalid={fieldErrors.prompt ? true : undefined}
          aria-describedby={fieldErrors.prompt ? `question-prompt-error-${formId}` : undefined}
        />
        {fieldErrors.prompt ? (
          <p id={`question-prompt-error-${formId}`} className="text-sm text-destructive">
            {fieldErrors.prompt}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`question-category-${formId}`}>Category</Label>
          <Input
            id={`question-category-${formId}`}
            name="category"
            disabled={isPending}
            value={values.category}
            onChange={(changeEvent) => update("category", changeEvent.target.value)}
            aria-invalid={fieldErrors.category ? true : undefined}
            aria-describedby={
              fieldErrors.category ? `question-category-error-${formId}` : undefined
            }
          />
          {fieldErrors.category ? (
            <p id={`question-category-error-${formId}`} className="text-sm text-destructive">
              {fieldErrors.category}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`question-answer-type-${formId}`}>Answer type</Label>
          <Select
            value={values.answerType}
            onValueChange={(value) => {
              if (value && isAnswerType(value)) update("answerType", value);
            }}
            disabled={isPending}
          >
            <SelectTrigger id={`question-answer-type-${formId}`} className="w-full">
              <SelectValue>{(value: string) => ANSWER_TYPE_LABEL[value as BriefQuestionAnswerType]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ANSWER_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {ANSWER_TYPE_LABEL[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={`question-help-text-${formId}`}>Help text (optional)</Label>
        <Textarea
          id={`question-help-text-${formId}`}
          name="helpText"
          disabled={isPending}
          value={values.helpText}
          onChange={(changeEvent) => update("helpText", changeEvent.target.value)}
          aria-invalid={fieldErrors.helpText ? true : undefined}
          aria-describedby={
            fieldErrors.helpText ? `question-help-text-error-${formId}` : undefined
          }
        />
        {fieldErrors.helpText ? (
          <p id={`question-help-text-error-${formId}`} className="text-sm text-destructive">
            {fieldErrors.helpText}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id={`question-required-${formId}`}
          checked={values.required}
          disabled={isPending}
          onCheckedChange={(checked) => update("required", checked === true)}
        />
        <Label htmlFor={`question-required-${formId}`}>Required</Label>
      </div>

      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}

      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" disabled={isPending} onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={isPending}>
          {isPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
          {isEdit ? "Save" : "Add question"}
        </Button>
      </div>
    </form>
  );
}
