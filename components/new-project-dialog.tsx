"use client";

// Smallest possible client boundary (tech-decisions.md convention): the
// projects page (Server Component) fetches and renders the list; this is
// only the interactive "New Project" dialog + form, paired with F026's
// already-implemented `createProject` Server Action.
//
// F184 (AS-333): also offers "Start from template" alongside the blank
// option, per this feature's draft scope ("Offered in the new-project
// dialog alongside the blank option"). `templateOptions` is server-fetched
// by the caller page and passed down as a typed prop
// (lib/queries/templates.ts's getWorkspaceProjectTemplateOptions), mirroring
// F183's NewFromTemplateButton pattern — this component never queries
// Supabase directly for its list. When there are no project templates yet,
// the picker step is simply never reachable (the "Start from template"
// tab is omitted), same "empty list -> feature not offered" convention
// NewFromTemplateButton already established.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createProject } from "@/lib/actions/projects";
import { createProjectFromTemplate } from "@/lib/actions/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { TaskTemplatePickerOption } from "@/lib/queries/templates";

export function NewProjectDialog({
  workspaceId,
  templateOptions = [],
}: {
  workspaceId: string;
  templateOptions?: TaskTemplatePickerOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [templateError, setTemplateError] = useState<string | null>(null);

  function resetAndClose() {
    setName("");
    setDescription("");
    setError(null);
    setTemplateId(null);
    setTemplateName("");
    setTemplateError(null);
    setOpen(false);
  }

  function handleSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await createProject(
        workspaceId,
        name,
        description || null,
      );

      if (result.ok) {
        toast.success(`${result.data.name} created.`);
        resetAndClose();
        router.refresh();
      } else {
        setError(result.error);
        toast.error(result.error);
      }
    });
  }

  function handleCreateFromTemplate(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setTemplateError(null);

    if (!templateId) {
      setTemplateError("Pick a template.");
      return;
    }
    if (!templateName.trim()) {
      setTemplateError("Project name is required.");
      return;
    }

    startTransition(async () => {
      const result = await createProjectFromTemplate(
        templateId,
        workspaceId,
        templateName,
      );

      if (result.ok) {
        toast.success(
          `${result.data.name} created with ${result.data.taskCount} task${
            result.data.taskCount === 1 ? "" : "s"
          } from the template.`,
        );
        resetAndClose();
        router.refresh();
      } else {
        setTemplateError(result.error);
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetAndClose();
        } else {
          setOpen(true);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button className="gap-1.5">
            <Plus className="size-4" aria-hidden="true" />
            New Project
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Project</DialogTitle>
          <DialogDescription>
            Start blank, or create from a saved project template.
          </DialogDescription>
        </DialogHeader>

        {templateOptions.length === 0 ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <BlankProjectFields
              name={name}
              description={description}
              error={error}
              isPending={isPending}
              onNameChange={setName}
              onDescriptionChange={setDescription}
            />
            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="ghost" disabled={isPending}>
                    Cancel
                  </Button>
                }
              />
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Creating...
                  </>
                ) : (
                  "Create Project"
                )}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <Tabs defaultValue="blank">
            <TabsList>
              <TabsTrigger value="blank">Blank</TabsTrigger>
              <TabsTrigger value="template">Start from template</TabsTrigger>
            </TabsList>
            <TabsContent value="blank">
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <BlankProjectFields
                  name={name}
                  description={description}
                  error={error}
                  isPending={isPending}
                  onNameChange={setName}
                  onDescriptionChange={setDescription}
                />
                <DialogFooter>
                  <DialogClose
                    render={
                      <Button type="button" variant="ghost" disabled={isPending}>
                        Cancel
                      </Button>
                    }
                  />
                  <Button type="submit" disabled={isPending}>
                    {isPending ? (
                      <>
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                        Creating...
                      </>
                    ) : (
                      "Create Project"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>
            <TabsContent value="template">
              <form
                onSubmit={handleCreateFromTemplate}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-col gap-2">
                  <Label htmlFor="template-project-name">Name</Label>
                  <Input
                    id="template-project-name"
                    disabled={isPending}
                    value={templateName}
                    onChange={(changeEvent) =>
                      setTemplateName(changeEvent.target.value)
                    }
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Template</Label>
                  <div className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-md border p-1">
                    {templateOptions.map((template) => (
                      <button
                        key={template.id}
                        type="button"
                        disabled={isPending}
                        onClick={() => setTemplateId(template.id)}
                        aria-pressed={templateId === template.id}
                        className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
                          templateId === template.id ? "bg-accent" : ""
                        }`}
                      >
                        <span className="truncate">{template.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {templateError && (
                  <p role="alert" className="text-sm text-destructive">
                    {templateError}
                  </p>
                )}
                <DialogFooter>
                  <DialogClose
                    render={
                      <Button type="button" variant="ghost" disabled={isPending}>
                        Cancel
                      </Button>
                    }
                  />
                  <Button type="submit" disabled={isPending}>
                    {isPending ? (
                      <>
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                        Creating...
                      </>
                    ) : (
                      "Create Project"
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function BlankProjectFields({
  name,
  description,
  error,
  isPending,
  onNameChange,
  onDescriptionChange,
}: {
  name: string;
  description: string;
  error: string | null;
  isPending: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-2">
        <Label htmlFor="project-name">Name</Label>
        <Input
          id="project-name"
          name="name"
          required
          disabled={isPending}
          value={name}
          onChange={(changeEvent) => onNameChange(changeEvent.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "project-name-error" : undefined}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="project-description">Description (optional)</Label>
        <Textarea
          id="project-description"
          name="description"
          disabled={isPending}
          value={description}
          onChange={(changeEvent) =>
            onDescriptionChange(changeEvent.target.value)
          }
        />
      </div>
      {error && (
        <p id="project-name-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
