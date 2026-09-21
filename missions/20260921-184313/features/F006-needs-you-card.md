# F006: needs-you-card.tsx

**Milestone:** M2  **Time:** 35 min  **Depends on:** F002, F003

## Assertions
AS-020, AS-021, AS-022, AS-023, AS-024, AS-025, AS-026

## Clarified implementation
Create `components/dashboard/needs-you-card.tsx` (Server Component — no client interactivity, items are links/form actions).

```tsx
type AttentionItem = {
  id: string;
  kind: 'approval' | 'client_request' | 'mention' | 'qa_return';
  title: string;
  subtitle: string;    // project name + time ago
  actionLabel: string; // "Review" | "Triage" | "Reply" | "Open"
  actionHref: string;  // link to the relevant page
};

type NeedsYouCardProps = {
  items: AttentionItem[];
  totalCount: number;  // total before cap (for overflow link)
  role: WorkspaceRole;
  workspaceSlug: string;
};
```

Rendering:
- Card with header "Needs you" + count badge (hot red when > 0)
- Up to 10 items; if totalCount > 10 show "X more in inbox →" link
- Each item: icon (color-coded by kind), title (truncated), subtitle, action button
- Icon colors: approval=violet, client_request=blue, mention=gray, qa_return=amber/red
- Action buttons are `<a>` links (not form submissions) to the relevant page
- Role gate: `kind === 'client_request'` items are filtered out when `role === 'member'` — this is done in the page.tsx before passing props, not inside the component itself
- Empty state: "You're all caught up ✓" with green icon

The page.tsx assembles `AttentionItem[]` from the settled query results before passing to this component.

ActionHref mapping:
- approval → `/w/{slug}/approvals`
- client_request → `/w/{slug}/client-requests`
- mention → `/w/{slug}/notifications`
- qa_return → task URL if available, else `/w/{slug}/my-tasks`

## Definition of done
- Component renders with empty items (empty state)
- Component renders with 12 items (shows 10 + overflow link)
- tsc clean
