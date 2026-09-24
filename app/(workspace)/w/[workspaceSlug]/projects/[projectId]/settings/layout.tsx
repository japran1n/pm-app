import { ProjectSettingsNav } from "@/components/project/project-settings-nav";

export default async function ProjectSettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceSlug: string; projectId: string }>;
}) {
  const { workspaceSlug, projectId } = await params;

  return (
    <div className="flex min-h-0 flex-1 gap-0">
      <ProjectSettingsNav workspaceSlug={workspaceSlug} projectId={projectId} />
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        {children}
      </div>
    </div>
  );
}
