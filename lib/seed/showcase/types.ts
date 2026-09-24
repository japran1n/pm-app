import type { PersonKey } from "./accounts";

export type StatusName =
  | "Backlog"
  | "To Do"
  | "Blocked"
  | "Canceled"
  | "In Design"
  | "In Dev"
  | "QA by Dev"
  | "QA by Design"
  | "Awaiting Client"
  | "Approved"
  | "Completed";

export type Priority = "urgent" | "high" | "medium" | "low" | "backlog" | null;

export type TypeKey =
  | "page"
  | "delivery"
  | "qa"
  | "client_request"
  | "change_request"
  | "improvement";

export type Discipline = "design" | "development" | "content_seo" | "pm" | "qa";

export type SectionSpec = {
  title: string;
  status: StatusName;
  kind?: "static" | "cms";
  component?: string; // page_components name
  assignees?: PersonKey[];
  clientVisible?: boolean;
};

export type TaskSpec = {
  ref: string;
  title: string;
  status: StatusName;
  priority: Priority;
  type: TypeKey;
  phase?: string;
  assignees?: PersonKey[];
  author?: PersonKey;
  watchers?: PersonKey[];
  start?: number | null; // day offsets from TODAY
  due?: number | null;
  estimate?: number; // minutes
  points?: number;
  tags?: string[];
  clientVisible?: boolean;
  pendingApproval?: boolean;
  blockedReason?: string;
  billable?: boolean;
  description?: string;
  checklist?: Array<[string, boolean]>;
  recurrence?: { freq: "daily" | "weekly" | "monthly" | "every_n_days"; interval: number };
  parent?: string; // ref of parent task (plain subtask)
  createdDaysAgo?: number;
  // Architecture page fields (type "page" only)
  page?: {
    slug: string;
    kind: "static" | "cms" | "cms_template" | "utility";
    sections: SectionSpec[];
    meta?: {
      intent: string;
      audience: string;
      primaryCta: string;
      tone: string;
      keywords: string[];
      copyStatus: "not_started" | "brief_ready" | "drafted" | "in_review" | "approved";
    };
    estimates?: Partial<Record<Discipline, number>>; // hours
    links?: Array<{ kind: string; label: string; url: string; clientVisible: boolean }>;
  };
  custom?: Record<string, string>; // custom field name → value
};
