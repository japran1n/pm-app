# F005: home-greeting.tsx

**Milestone:** M2  **Time:** 20 min  **Depends on:** F001

## Assertions
AS-010, AS-011, AS-012

## Clarified implementation
Create `components/dashboard/home-greeting.tsx` (Server Component):

```tsx
type HomeGreetingProps = {
  userName: string;         // from user metadata
  timezone: string;         // from getCurrentUserTimezone
  attentionCount: number;   // from settled needs-you data
  todayTaskCount: number;   // from settled my-tasks today bucket
  overdueCount: number;     // from settled my-tasks overdue bucket
};
```

Renders:
- Today's date formatted in `timezone` locale (e.g. "Mon 21 Sep 2026") — use `Intl.DateTimeFormat` with `timeZone: timezone`
- Heading: "Good morning, {userName}" (hour-based: <12 morning, 12-17 afternoon, 17+ evening)
- Subtitle sentence combining attentionCount, todayTaskCount, overdueCount:
  - e.g. "3 things need you · 2 tasks due today · 1 overdue"
  - If all zero: "Nothing urgent today — you're on top of it."

Style: Supabase DS tokens. Date is small mono text. Name heading is ~22px semibold. Subtitle is muted text.

No interactivity — pure server component.

## Definition of done
- File exists and exports `HomeGreeting` component
- Renders correctly with all-zero props (no crash)
- tsc clean
