import { HelpContent } from "@/components/help/help-content";

// Internal "how this dashboard works" documentation page -- deliberately
// NOT under a name like "docs" (already taken by the workspace wiki, see
// app/(workspace)/w/[workspaceSlug]/docs) or "how-we-work" (already the
// client-portal's own process page under app/(portal)/...). This page is
// static and role-agnostic (workers/PMs/admins alike; nothing here is
// per-workspace data), so there is nothing to fetch -- the whole page is
// just `HelpContent`, which is also what tests/unit/help-content-render.test.tsx
// renders directly.
export default function HelpPage() {
  return <HelpContent />;
}
