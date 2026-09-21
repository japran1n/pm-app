"use client";

import { useSetBreadcrumb } from "@/components/nav/breadcrumb-context";

export function TeamMemberBreadcrumb({ label }: { label: string }) {
  useSetBreadcrumb([{ label }]);
  return null;
}
