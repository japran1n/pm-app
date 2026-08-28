"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import { DashboardSkeleton } from "./dashboard-skeleton";
import type { DashboardContent } from "./dashboard-content";

const DashboardContentDynamic = dynamic(
  () => import("./dashboard-content").then((m) => ({ default: m.DashboardContent })),
  { ssr: false, loading: () => <DashboardSkeleton /> },
);

export function DashboardContentLazy(props: ComponentProps<typeof DashboardContent>) {
  return <DashboardContentDynamic {...props} />;
}
