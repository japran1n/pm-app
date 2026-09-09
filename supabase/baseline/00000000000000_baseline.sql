-- Baseline schema for `public`, generated from the live catalog of
-- project qcipqonnqajmazdbysow on 2026-09-09.
--
-- This is the squashed equivalent of the 246 incremental migrations in
-- supabase/migrations/. It is NOT applied to the existing project (whose
-- ledger already records those 246). It exists so a new Supabase project can
-- be stood up from one file, with every fix from 20261120* already folded in.
--
-- Regenerate with scripts/gen-baseline-schema.mjs.
--
-- Not included: auth/storage schemas (Supabase manages those), row data, and
-- role/grant statements that require superuser.

set check_function_bodies = off;


-- ============================== extensions ==============================

create extension if not exists "btree_gist" with schema public;
create extension if not exists "pg_cron" with schema pg_catalog;
create extension if not exists "pg_stat_statements" with schema extensions;
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "supabase_vault" with schema vault;
create extension if not exists "uuid-ossp" with schema extensions;

-- ================================ types =================================

create type public.project_billing_model as enum ('hourly', 'fixed_price');

-- =============================== tables ================================

create table if not exists public._realtime_capability_probe (
  "id" uuid default gen_random_uuid() not null,
  "tag" text not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.active_timers (
  "id" uuid default gen_random_uuid() not null,
  "task_id" uuid not null,
  "user_id" uuid not null,
  "started_at" timestamp with time zone default now() not null
);
create table if not exists public.ai_messages (
  "id" uuid default gen_random_uuid() not null,
  "thread_id" uuid not null,
  "role" text not null,
  "content" text default ''::text not null,
  "tool_calls" jsonb,
  "proposals" jsonb,
  "usage" jsonb,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.ai_threads (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "project_id" uuid,
  "doc_id" uuid,
  "created_by" uuid not null,
  "title" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.approval_requests (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "phase_id" uuid,
  "subject_type" text not null,
  "subject_id" uuid,
  "artifact_url" text,
  "artifact_snapshot_path" text,
  "title" text not null,
  "description" text,
  "decision_type" text not null,
  "state" text default 'pending'::text not null,
  "requested_by" uuid not null,
  "requested_at" timestamp with time zone default now() not null,
  "due_at" timestamp with time zone,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "decision_note" text,
  "round" integer default 1 not null,
  "supersedes_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "resulting_task_id" uuid
);
create table if not exists public.attachments (
  "id" uuid default gen_random_uuid() not null,
  "task_id" uuid not null,
  "file_url" text not null,
  "file_name" text not null,
  "uploaded_by" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "mime_type" text
);
create table if not exists public.audit_log (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "actor_id" uuid not null,
  "action" text not null,
  "target_type" text not null,
  "target_id" uuid,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.board_swimlane_prefs (
  "user_id" uuid not null,
  "project_id" uuid not null,
  "group_by" text default 'none'::text not null,
  "collapsed_lanes" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.calendar_blocks (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "project_id" uuid,
  "user_id" uuid not null,
  "task_id" uuid,
  "title" text not null,
  "starts_at" timestamp with time zone not null,
  "ends_at" timestamp with time zone not null,
  "color" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "block_type" text default 'general'::text not null
);
create table if not exists public.channel_members (
  "channel_id" uuid not null,
  "user_id" uuid not null,
  "last_read_at" timestamp with time zone default now() not null,
  "joined_at" timestamp with time zone default now() not null
);
create table if not exists public.channels (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "project_id" uuid,
  "kind" text not null,
  "name" text,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "dm_user_low" uuid,
  "dm_user_high" uuid
);
create table if not exists public.checklist_items (
  "id" uuid default gen_random_uuid() not null,
  "task_id" uuid not null,
  "content" text not null,
  "is_checked" boolean default false not null,
  "position" double precision default 0 not null,
  "checked_by" uuid,
  "checked_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.client_deliverables (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "phase_id" uuid,
  "task_id" uuid,
  "title" text not null,
  "description" text,
  "kind" text not null,
  "owner_name" text not null,
  "due_at" date,
  "blocking" boolean default false not null,
  "state" text default 'not_started'::text not null,
  "delivered_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "accepted_by" uuid,
  "review_note" text,
  "position" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "swept_at" timestamp with time zone
);
create table if not exists public.client_requests (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "created_by" uuid not null,
  "title" text not null,
  "body" text,
  "desired_by" date,
  "status" text default 'submitted'::text not null,
  "decline_reason" text,
  "converted_task_id" uuid,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "kind" text default 'change'::text not null,
  "severity" text,
  "scope_verdict" text,
  "quoted_hours" numeric,
  "quoted_amount" numeric,
  "quote_currency" text,
  "quote_note" text,
  "quote_valid_until" date,
  "client_decision" text default 'pending'::text not null,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "track" text,
  "track_overridden" boolean default false not null,
  "track_override_reason" text,
  "approval_request_id" uuid,
  "origin_assumption_id" uuid,
  "quote_sent_at" timestamp with time zone
);
create table if not exists public.comment_reactions (
  "comment_id" uuid not null,
  "user_id" uuid not null,
  "emoji" text not null,
  "created_at" timestamp with time zone default now() not null,
  "task_id" uuid not null
);
create table if not exists public.comments (
  "id" uuid default gen_random_uuid() not null,
  "task_id" uuid not null,
  "user_id" uuid not null,
  "text" text not null,
  "created_at" timestamp with time zone default now() not null,
  "deleted_at" timestamp with time zone,
  "body_json" jsonb,
  "body_text" text,
  "deleted_by" uuid,
  "edited_at" timestamp with time zone,
  "internal" boolean default false not null
);
create table if not exists public.doc_folders (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "project_id" uuid,
  "parent_id" uuid,
  "name" text not null,
  "position" double precision default 0 not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.doc_links (
  "id" uuid default gen_random_uuid() not null,
  "doc_id" uuid not null,
  "url" text not null,
  "title" text not null,
  "description" text,
  "thumbnail_url" text,
  "position" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.docs (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "project_id" uuid,
  "folder_id" uuid,
  "title" text default 'Untitled'::text not null,
  "content" text default ''::text not null,
  "position" double precision default 0 not null,
  "created_by" uuid not null,
  "updated_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "client_visible" boolean default false not null,
  "doc_kind" text default 'note'::text not null,
  "relevant_from" text
);
create table if not exists public.f016i_gated_function_oids (
  "oid" oid not null,
  "gated_at" timestamp with time zone default now() not null
);
create table if not exists public.message_attachments (
  "id" uuid default gen_random_uuid() not null,
  "channel_id" uuid not null,
  "message_id" uuid,
  "storage_path" text not null,
  "file_name" text not null,
  "mime_type" text,
  "file_size" bigint,
  "uploaded_by" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.message_reactions (
  "message_id" uuid not null,
  "user_id" uuid not null,
  "emoji" text not null,
  "created_at" timestamp with time zone default now() not null,
  "channel_id" uuid not null
);
create table if not exists public.messages (
  "id" uuid default gen_random_uuid() not null,
  "channel_id" uuid not null,
  "sender_id" uuid not null,
  "body_json" jsonb not null,
  "parent_message_id" uuid,
  "edited_at" timestamp with time zone,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "body_text" text default ''::text not null
);
create table if not exists public.metric_snapshots (
  "id" uuid default gen_random_uuid() not null,
  "metric_id" uuid not null,
  "value" numeric not null,
  "measured_at" date not null,
  "note" text,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.notification_preferences (
  "user_id" uuid not null,
  "mention_in_app" boolean default true not null,
  "mention_email" boolean default true not null,
  "task_assigned_in_app" boolean default true not null,
  "task_assigned_email" boolean default true not null,
  "comment_reply_in_app" boolean default true not null,
  "comment_reply_email" boolean default false not null,
  "watcher_update_in_app" boolean default true not null,
  "watcher_update_email" boolean default false not null,
  "task_due_soon_in_app" boolean default true not null,
  "task_due_soon_email" boolean default false not null,
  "email_enabled" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "chat_dm_in_app" boolean default true not null,
  "chat_thread_reply_in_app" boolean default true not null,
  "sound_enabled" boolean default true not null,
  "sound_volume" smallint default 60 not null,
  "sound_only_when_unfocused" boolean default true not null
);
create table if not exists public.notifications (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "workspace_id" uuid not null,
  "kind" text not null,
  "actor_id" uuid,
  "task_id" uuid,
  "comment_id" uuid,
  "payload" jsonb default '{}'::jsonb not null,
  "read_at" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "project_id" uuid
);
create table if not exists public.page_links (
  "id" uuid default gen_random_uuid() not null,
  "task_id" uuid not null,
  "kind" text not null,
  "label" text not null,
  "url" text not null,
  "client_visible" boolean default false not null,
  "position" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.personal_todos (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "workspace_id" uuid not null,
  "title" text not null,
  "is_done" boolean default false not null,
  "position" double precision default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "task_id" uuid,
  "project_id" uuid
);
create table if not exists public.profiles (
  "id" uuid not null,
  "display_name" text,
  "avatar_url" text,
  "color" text,
  "timezone" text default 'UTC'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "tour_completed_at" timestamp with time zone
);
create table if not exists public.project_accounts (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "service" text not null,
  "owner" text not null,
  "status" text not null,
  "renewal_date" date,
  "note" text,
  "client_visible" boolean default true not null,
  "position" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.project_assumptions (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "text" text not null,
  "state" text default 'assumed'::text not null,
  "confirmed_on" date,
  "confirmed_by_name" text,
  "client_visible" boolean default true not null,
  "flagged_by_client_at" timestamp with time zone,
  "flagged_note" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.project_budgets (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "period_start" date not null,
  "period_end" date not null,
  "sold_minutes" integer not null,
  "currency" text,
  "rate_amount" numeric,
  "rollover" text default 'none'::text not null,
  "note" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.project_custom_fields (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "name" text not null,
  "field_type" text not null,
  "position" double precision default 0 not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.project_decision_owners (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "decision_type" text not null,
  "user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.project_decision_types (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "name" text not null,
  "description" text,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.project_decisions (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "phase_id" uuid,
  "title" text not null,
  "rationale" text,
  "decision_type" text not null,
  "decided_on" date default CURRENT_DATE not null,
  "decided_by_name" text,
  "client_visible" boolean default true not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.project_favorites (
  "user_id" uuid not null,
  "project_id" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.project_improvements (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "area" text not null,
  "explanation" text not null,
  "before_path" text,
  "after_path" text,
  "position" integer default 0 not null,
  "client_visible" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.project_links (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "kind" text not null,
  "label" text not null,
  "url" text not null,
  "client_visible" boolean default false not null,
  "position" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.project_members (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "user_id" uuid not null,
  "project_role" text default 'member'::text not null,
  "added_by" uuid,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.project_metrics (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "name" text not null,
  "unit" text,
  "source" text not null,
  "baseline_value" numeric,
  "baseline_at" date,
  "target_value" numeric,
  "direction" text default 'higher'::text not null,
  "display_max" numeric,
  "client_visible" boolean default true not null,
  "position" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.project_phases (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "name" text not null,
  "client_description" text,
  "position" integer default 0 not null,
  "state" text default 'not_started'::text not null,
  "planned_start" date,
  "planned_end" date,
  "actual_start" date,
  "actual_end" date,
  "client_visible" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "blocked_reason" text
);
create table if not exists public.project_roles (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "user_id" uuid not null,
  "role" text not null,
  "note" text,
  "added_by" uuid,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.project_scope_documents (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "title" text not null,
  "kind" text not null,
  "file_path" text,
  "url" text,
  "uploaded_by" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.project_scope_items (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "title" text not null,
  "description" text,
  "included" boolean not null,
  "source" text not null,
  "change_request_id" uuid,
  "position" integer default 0 not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.project_statuses (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "name" text not null,
  "color" text not null,
  "category" text not null,
  "position" double precision default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "client_description" text,
  "client_bucket" text
);
create table if not exists public.projects (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "name" text not null,
  "description" text,
  "start_date" date,
  "end_date" date,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "created_by" uuid,
  "deleted_at" timestamp with time zone,
  "key" text default ''::text not null,
  "task_counter" integer default 0 not null,
  "visibility" text default 'workspace'::text not null,
  "archived_by" uuid,
  "target_launch_date" date,
  "launch_confidence" text,
  "launch_note" text,
  "portal_enabled" boolean default false not null,
  "portal_enabled_at" timestamp with time zone,
  "baseline_frozen_at" timestamp with time zone,
  "warranty_until" date,
  "warranty_terms" text,
  "billing_model" public.project_billing_model default 'fixed_price'::project_billing_model not null,
  "sidebar_position" integer,
  "icon" text
);
create table if not exists public.saved_views (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "project_id" uuid,
  "owner_id" uuid not null,
  "name" text not null,
  "scope" text default 'personal'::text not null,
  "view_type" text default 'list'::text not null,
  "config" jsonb default '{}'::jsonb not null,
  "is_default" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "position" double precision default 0 not null
);
create table if not exists public.status_template_items (
  "id" uuid default gen_random_uuid() not null,
  "template_id" uuid not null,
  "name" text not null,
  "color" text not null,
  "category" text not null,
  "position" double precision default 0 not null
);
create table if not exists public.status_templates (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "name" text not null,
  "created_by" uuid,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.task_activity (
  "id" uuid default gen_random_uuid() not null,
  "task_id" uuid not null,
  "actor_id" uuid,
  "kind" text not null,
  "field" text,
  "old_value" jsonb,
  "new_value" jsonb,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.task_assignees (
  "task_id" uuid not null,
  "user_id" uuid not null,
  "assigned_by" uuid,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.task_custom_field_values (
  "task_id" uuid not null,
  "field_id" uuid not null,
  "value" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public.task_dependencies (
  "id" uuid default gen_random_uuid() not null,
  "blocking_task_id" uuid not null,
  "blocked_task_id" uuid not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.task_templates (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "kind" text default 'task'::text not null,
  "name" text not null,
  "payload" jsonb not null,
  "created_by" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.task_types (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "name" text not null,
  "color" text not null,
  "position" double precision default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "system_key" text,
  "is_billable" boolean default true not null,
  "default_client_visible" boolean default false not null
);
create table if not exists public.task_watchers (
  "task_id" uuid not null,
  "user_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "is_watching" boolean default true not null
);
create table if not exists public.tasks (
  "id" uuid default gen_random_uuid() not null,
  "project_id" uuid not null,
  "title" text not null,
  "description" text,
  "status" text default 'todo'::text not null,
  "priority" text,
  "tags" text[] default '{}'::text[] not null,
  "start_date" date,
  "due_date" date,
  "points" integer,
  "author_id" uuid not null,
  "assignee_id" uuid,
  "position" double precision default 0 not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "deleted_at" timestamp with time zone,
  "number" integer default 0 not null,
  "search_vector" tsvector,
  "parent_task_id" uuid,
  "deleted_via_task_id" uuid,
  "estimate_minutes" integer,
  "description_json" jsonb,
  "description_text" text,
  "recurrence" jsonb,
  "recurrence_parent_id" uuid,
  "last_occurrence_at" timestamp with time zone,
  "deleted_by" uuid,
  "status_id" uuid,
  "client_visible" boolean default false not null,
  "task_type_id" uuid not null,
  "pending_client_approval" boolean default false not null,
  "phase_id" uuid,
  "page_slug" text,
  "page_order" integer,
  "blocked_reason" text
);
create table if not exists public.time_entries (
  "id" uuid default gen_random_uuid() not null,
  "task_id" uuid not null,
  "user_id" uuid not null,
  "minutes" integer not null,
  "billable" boolean default true not null,
  "note" text,
  "entry_date" date default CURRENT_DATE not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "work_category" text
);
create table if not exists public.time_off_entries (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid not null,
  "start_date" date not null,
  "end_date" date not null,
  "note" text,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.view_tasks (
  "id" uuid default gen_random_uuid() not null,
  "view_id" uuid not null,
  "task_id" uuid not null,
  "position" double precision default 0 not null,
  "added_at" timestamp with time zone default now() not null,
  "added_by" uuid
);
create table if not exists public.workspace_members (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "user_id" uuid,
  "role" text default 'member'::text not null,
  "status" text default 'invited'::text not null,
  "invited_email" text,
  "created_at" timestamp with time zone default now() not null,
  "invited_project_id" uuid,
  "portal_last_seen_at" timestamp with time zone,
  "status_note" text,
  "status_note_until" date
);
create table if not exists public.workspace_slug_history (
  "id" uuid default gen_random_uuid() not null,
  "workspace_id" uuid not null,
  "old_slug" text not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public.workspaces (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "slug" text not null,
  "created_at" timestamp with time zone default now() not null,
  "deleted_at" timestamp with time zone,
  "logo_url" text
);

-- ============================== functions ==============================

CREATE OR REPLACE FUNCTION public.accept_client_request_atomic(p_request_id uuid)
 RETURNS TABLE(task_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_title text;
  v_body text;
  v_desired_by date;
  v_status text;
  v_task_id uuid;
  v_caller_role text;
  v_scope_verdict text;
  v_client_decision text;
  v_quote_valid_until date;
  v_task_type_key text;
  v_task_type_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select cr.project_id, cr.title, cr.body, cr.desired_by, cr.status, p.workspace_id,
         cr.scope_verdict, cr.client_decision, cr.quote_valid_until
    into v_project_id, v_title, v_body, v_desired_by, v_status, v_workspace_id,
         v_scope_verdict, v_client_decision, v_quote_valid_until
    from public.client_requests cr
    join public.projects p on p.id = cr.project_id
   where cr.id = p_request_id
     for update of cr;

  if v_project_id is null then
    raise exception 'request not found';
  end if;

  select wm.role into v_caller_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_user_id
     and wm.status = 'active';

  if v_caller_role is null or v_caller_role = 'viewer' or v_caller_role = 'client' then
    raise exception 'caller does not have permission to review requests'
      using errcode = '42501';
  end if;

  if v_caller_role = 'client' then
    raise exception 'a client cannot accept their own request'
      using errcode = '42501';
  end if;

  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  if v_scope_verdict = 'change_request' then
    if v_client_decision is distinct from 'approved' then
      raise exception 'this change request has not been approved by the client yet'
        using errcode = 'CR047';
    end if;

    if v_quote_valid_until is not null and v_quote_valid_until < current_date then
      raise exception 'this change request''s quote has expired; send a fresh quote before accepting'
        using errcode = 'CR048';
    end if;
  end if;

  if v_status = 'accepted' then
    raise exception 'request already accepted';
  end if;

  -- F116 (AS-063): resolved by system_key, never by name.
  if v_scope_verdict = 'change_request' then
    v_task_type_key := 'change_request';
    v_task_type_id := public.ensure_task_type(
      v_workspace_id, 'change_request', 'Change request', '#8b5cf6', true, true
    );
  else
    v_task_type_key := 'client_request';
    v_task_type_id := public.ensure_task_type(
      v_workspace_id, 'client_request', 'Client request', '#f59e0b', true, true
    );
  end if;

  insert into public.tasks (project_id, title, description, status, author_id, due_date, client_visible, task_type_id)
  values (v_project_id, v_title, v_body, 'todo', v_user_id, v_desired_by, true, v_task_type_id)
  returning id into v_task_id;

  update public.client_requests
     set status = 'accepted',
         decline_reason = null,
         converted_task_id = v_task_id,
         reviewed_by = v_user_id,
         reviewed_at = now()
   where id = p_request_id;

  return query select v_task_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.accept_deliverable_atomic(p_deliverable_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS TABLE(deliverable_id uuid, state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_title text;
  v_new_state text;
begin
  if v_user_id is null then
    raise exception 'accept_deliverable_atomic: not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('accepted', 'returned', 'waived') then
    raise exception 'accept_deliverable_atomic: invalid decision %', p_decision using errcode = '22023';
  end if;

  if p_decision = 'returned' and (p_note is null or btrim(p_note) = '') then
    raise exception 'accept_deliverable_atomic: a note is required when returning a deliverable' using errcode = '22023';
  end if;

  select cd.project_id, cd.title
    into v_project_id, v_title
    from client_deliverables cd
   where cd.id = p_deliverable_id
     for update of cd;

  if v_project_id is null then
    raise exception 'accept_deliverable_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if not public.is_project_workspace_writer(v_project_id) then
    raise exception 'accept_deliverable_atomic: you do not have permission to review this deliverable' using errcode = '42501';
  end if;

  select p.workspace_id into v_workspace_id from projects p where p.id = v_project_id;
  if v_workspace_id is null then
    raise exception 'accept_deliverable_atomic: project not found' using errcode = 'P0002';
  end if;

  if p_decision = 'accepted' then
    v_new_state := 'accepted';

    update client_deliverables
       set state = 'accepted',
           accepted_at = now(),
           accepted_by = v_user_id,
           review_note = null
     where id = p_deliverable_id;
  elsif p_decision = 'waived' then
    v_new_state := 'waived';

    -- A waived deliverable was never accepted -- accepted_at/accepted_by
    -- stay null so "who accepted this and when" never lies about a
    -- decision that was actually "we decided not to chase it".
    -- delivered_at is left untouched: a deliverable can be waived either
    -- before or after the client ever delivered it, and if they already
    -- did, that timestamp is still a true fact about what happened.
    update client_deliverables
       set state = 'waived',
           accepted_at = null,
           accepted_by = null,
           review_note = p_note
     where id = p_deliverable_id;
  else
    v_new_state := 'in_progress';

    -- A returned item goes back to 'in_progress', not 'delivered': the
    -- client has to re-deliver, this is not merely un-reviewing the same
    -- upload. accepted_at/accepted_by/delivered_at are cleared for the
    -- same reason a returned item's history shouldn't still claim an
    -- acceptance or a still-current delivery timestamp that this
    -- decision just superseded.
    update client_deliverables
       set state = 'in_progress',
           delivered_at = null,
           accepted_at = null,
           accepted_by = null,
           review_note = p_note
     where id = p_deliverable_id;
  end if;

  perform public.write_audit_log_entry(
    v_workspace_id,
    case
      when p_decision = 'accepted' then 'client_deliverable.accepted'
      when p_decision = 'waived' then 'client_deliverable.waived'
      else 'client_deliverable.returned'
    end,
    'client_deliverable',
    p_deliverable_id,
    jsonb_build_object('title', v_title, 'note', p_note)
  );

  return query select p_deliverable_id, v_new_state;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.apply_status_template(p_project_id uuid, p_template_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_workspace_id uuid;
  v_template_workspace_id uuid;
  v_caller_role text;
  v_old_status record;
  v_new_status_id uuid;
  v_next_position double precision;
begin
  select workspace_id into v_workspace_id from projects where id = p_project_id;
  if v_workspace_id is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  -- security definer bypasses RLS entirely once inside this function —
  -- the two policies above only gate whether a plain SELECT/INSERT/UPDATE
  -- on status_templates/status_template_items succeeds, they say nothing
  -- about a direct RPC call to THIS function. Re-check the caller's role
  -- explicitly, the same "security definer + revoke public + re-verify
  -- membership inside the function body" shape every other privileged RPC
  -- in this schema uses (e.g. reassign_and_delete_project_status). Without
  -- this, `grant execute ... to authenticated` below would let ANY
  -- signed-in user — including a non-member of this workspace — replace
  -- any project's columns by calling the RPC directly, RLS or no RLS.
  select wm.role into v_caller_role
  from workspace_members wm
  where wm.workspace_id = v_workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'active';

  if v_caller_role is null or v_caller_role not in ('owner', 'admin') then
    raise exception 'Only a workspace owner or admin may apply a status template.'
      using errcode = '42501';
  end if;

  select workspace_id into v_template_workspace_id
  from status_templates where id = p_template_id;
  if v_template_workspace_id is null then
    raise exception 'Template not found.' using errcode = 'P0002';
  end if;
  if v_template_workspace_id <> v_workspace_id then
    raise exception 'Template must belong to the project''s workspace.'
      using errcode = '22023';
  end if;

  -- Insert every template item not already present by name, so a
  -- same-named column is reused rather than duplicated.
  select coalesce(max(position), 0) into v_next_position
  from project_statuses where project_id = p_project_id;

  insert into project_statuses (project_id, name, color, category, position)
  select
    p_project_id,
    sti.name,
    sti.color,
    sti.category,
    v_next_position + sti.position
  from status_template_items sti
  where sti.template_id = p_template_id
    and not exists (
      select 1 from project_statuses ps
      where ps.project_id = p_project_id and ps.name = sti.name
    )
  order by sti.position;

  -- Reassign tasks off any column that is NOT one of the template's names,
  -- to the first surviving column (template item, or a same-named
  -- pre-existing column) sharing that old column's category.
  for v_old_status in
    select ps.id, ps.category
    from project_statuses ps
    where ps.project_id = p_project_id
      and ps.name not in (
        select sti.name from status_template_items sti
        where sti.template_id = p_template_id
      )
  loop
    select ps2.id into v_new_status_id
    from project_statuses ps2
    where ps2.project_id = p_project_id
      and ps2.category = v_old_status.category
      and ps2.name in (
        select sti.name from status_template_items sti
        where sti.template_id = p_template_id
      )
    order by ps2.position
    limit 1;

    -- No same-category survivor (e.g. the template has no "done" column
    -- at all): fall back to ANY surviving template column, so a task is
    -- never left pointing at a status_id about to be deleted.
    if v_new_status_id is null then
      select ps2.id into v_new_status_id
      from project_statuses ps2
      where ps2.project_id = p_project_id
        and ps2.name in (
          select sti.name from status_template_items sti
          where sti.template_id = p_template_id
        )
      order by ps2.position
      limit 1;
    end if;

    update tasks
    set status_id = v_new_status_id,
        status = (select name from project_statuses where id = v_new_status_id)
    where status_id = v_old_status.id;

    delete from project_statuses where id = v_old_status.id;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_portal_task_atomic(p_task_id uuid)
 RETURNS TABLE(task_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_project_id uuid;
  v_workspace_id uuid;
begin
  select a.project_id into v_project_id
    from public.assert_portal_task_actionable_by_client(p_task_id) a;

  select p.workspace_id into v_workspace_id
    from public.projects p
   where p.id = v_project_id;

  update tasks
     set pending_client_approval = false
   where id = p_task_id;

  perform public.write_audit_log_entry(
    v_workspace_id,
    'task.approved',
    'task',
    p_task_id,
    jsonb_build_object('project_id', v_project_id)
  );

  return query select p_task_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assert_portal_task_actionable_by_client(p_task_id uuid)
 RETURNS TABLE(task_id uuid, project_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_client_visible boolean;
  v_pending boolean;
  v_deleted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select t.project_id, p.workspace_id, t.client_visible, t.pending_client_approval, t.deleted_at
    into v_project_id, v_workspace_id, v_client_visible, v_pending, v_deleted_at
    from tasks t
    join projects p on p.id = t.project_id
   where t.id = p_task_id
     for update of t;

  if v_project_id is null or v_deleted_at is not null then
    raise exception 'task not found';
  end if;

  if not exists (
    select 1
      from workspace_members wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = v_user_id
       and wm.status = 'active'
       and wm.role = 'client'
  ) then
    raise exception 'task not found';
  end if;

  -- F016d: visibility, portal_enabled and client_visible, one call.
  if not public.client_gate(v_project_id, v_client_visible, p_require_client_role => false) then
    raise exception 'task not found';
  end if;

  if not v_pending then
    raise exception 'task not found';
  end if;

  -- F009b (M2 remediation, B2): AS-022's actual bug -- a client who owns
  -- no decision type on this project succeeded here while the Approvals
  -- view correctly refused the same caller with 42501. Closed by the
  -- same predicate `decide_approval_atomic` uses, applied with
  -- `p_decision_type := null` ("owns at least one decision type"),
  -- since the legacy toggle this function guards carries no decision
  -- type of its own.
  --
  -- F009d: this is the one branch, of the five in this function, where
  -- naming the refusal is safe -- see this migration's own header. Every
  -- earlier branch still raises the shared 'task not found' oracle,
  -- unchanged.
  if not public.is_project_decision_owner(v_project_id, null, v_user_id) then
    raise exception 'assert_portal_task_actionable_by_client: no one is assigned to decide this yet'
      using errcode = '42501';
  end if;

  return query select p_task_id, v_project_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_project_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.key is null or new.key = '' then
    -- F025d: this write is the application's own internal bookkeeping
    -- (generating the project's key), not a member creating a project
    -- with a pre-set key, so it steps around projects_enforce_field_
    -- role_allowlist for the guard invocation that immediately follows
    -- this trigger in the same statement (projects_assign_key sorts
    -- before projects_enforce_field_role_allowlist by name). The guard
    -- itself turns this flag back off the instant it observes it on --
    -- see that function's own comment for why the reset cannot live
    -- here.
    perform set_config('app.projects_field_guard_bypass', 'on', true);
    new.key := public.generate_unique_project_key(new.workspace_id, new.name);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assign_task_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_number integer;
begin
  if new.number is null or new.number = 0 then
    -- F025c: this UPDATE is the application's own internal bookkeeping
    -- (assigning the task's per-project number), not a member editing
    -- the project, so it steps around projects_enforce_field_role_
    -- allowlist for the duration of this one statement rather than
    -- requiring task_counter to be named in that guard's allow-list.
    perform set_config('app.projects_field_guard_bypass', 'on', true);

    update projects
    set task_counter = task_counter + 1
    where id = new.project_id
    returning task_counter into v_number;

    perform set_config('app.projects_field_guard_bypass', 'off', true);

    if v_number is null then
      raise exception 'project % not found for task number assignment', new.project_id;
    end if;

    new.number := v_number;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.bulk_delete_tasks_atomic(p_task_ids uuid[], p_deleted_by uuid, p_deleted_at timestamp with time zone)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_allowed_ids uuid[];
  v_deleted_ids uuid[];
begin
  if auth.uid() is not null then
    -- Direct `authenticated` caller: narrow p_task_ids down to only the
    -- ids this caller is actually allowed to delete, same predicate
    -- bulkDeleteTasks applies itself before ever calling this RPC.
    select array_agg(t.id) into v_allowed_ids
    from public.tasks t
    where t.id = any(p_task_ids)
      and public.is_task_workspace_writer(t.id)
      and public.is_project_visible_to(t.project_id);

    -- Also pin the attribution to the real caller — a direct caller must
    -- not be able to attribute a delete to someone else.
    p_deleted_by := auth.uid();
  else
    -- service_role call path (admin.rpc from bulkDeleteTasks): the
    -- Server Action has already filtered p_task_ids down to allowedIds
    -- and re-verified them itself; trust it, same as create_channel_atomic
    -- trusts its own service_role caller.
    v_allowed_ids := p_task_ids;
  end if;

  if v_allowed_ids is null or array_length(v_allowed_ids, 1) is null then
    return '{}';
  end if;

  with deleted as (
    update public.tasks
    set deleted_at = p_deleted_at,
        deleted_by = p_deleted_by
    where id = any(v_allowed_ids)
      and deleted_at is null
    returning id
  )
  select array_agg(id) into v_deleted_ids from deleted;

  if v_deleted_ids is not null and array_length(v_deleted_ids, 1) > 0 then
    update public.tasks
    set deleted_at = p_deleted_at,
        deleted_by = p_deleted_by
    where parent_task_id = any(v_deleted_ids)
      and deleted_at is null;
  end if;

  return coalesce(v_deleted_ids, '{}');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.can_modify_comment(target_comment_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from comments c
    join tasks t on t.id = c.task_id
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where c.id = target_comment_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role <> 'viewer'
      and (
        c.user_id = auth.uid()
        or wm.role in ('owner', 'admin')
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.can_read_workspace_docs(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role <> 'client'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.can_write_workspace_docs(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role not in ('viewer', 'client')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.cascade_delete_task(p_task_id uuid)
 RETURNS TABLE(id uuid, deleted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update tasks
    set deleted_at = now()
    where tasks.id = p_task_id
      and tasks.deleted_at is null;

  update tasks
    set deleted_at = now(),
        deleted_via_task_id = p_task_id
    where tasks.parent_task_id = p_task_id
      and tasks.deleted_at is null;

  return query
    select t.id, t.deleted_at
    from tasks t
    where t.id = p_task_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cascade_delete_task(p_task_id uuid, p_deleted_by uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, deleted_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update tasks
    set deleted_at = now(),
        deleted_by = p_deleted_by
    where tasks.id = p_task_id
      and tasks.deleted_at is null;

  update tasks
    set deleted_at = now(),
        deleted_via_task_id = p_task_id,
        deleted_by = p_deleted_by
    where tasks.parent_task_id = p_task_id
      and tasks.deleted_at is null;

  return query
    select t.id, t.deleted_at
    from tasks t
    where t.id = p_task_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.change_workspace_slug_atomic(p_workspace_id uuid, p_old_slug text, p_new_slug text)
 RETURNS TABLE(slug text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_current_slug text;
  v_deleted_at timestamptz;
begin
  select workspaces.slug, workspaces.deleted_at
    into v_current_slug, v_deleted_at
    from workspaces
   where workspaces.id = p_workspace_id
     for update;

  if v_current_slug is null then
    raise exception 'workspace not found';
  end if;

  if v_deleted_at is not null then
    raise exception 'workspace not found';
  end if;

  if v_current_slug <> p_old_slug then
    raise exception 'workspace slug changed concurrently';
  end if;

  insert into workspace_slug_history (workspace_id, old_slug)
  values (p_workspace_id, p_old_slug);

  update workspaces
     set slug = p_new_slug
   where workspaces.id = p_workspace_id;

  return query select p_new_slug;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.check_doc_folder_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  parent_workspace_id uuid;
  parent_project_id uuid;
begin
  if new.parent_id is not null then
    select workspace_id, project_id
      into parent_workspace_id, parent_project_id
      from doc_folders
      where id = new.parent_id;

    if parent_workspace_id is distinct from new.workspace_id
       or parent_project_id is distinct from new.project_id then
      raise exception 'doc_folders: parent folder scope (workspace_id, project_id) must match child scope';
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clear_client_deliverable_swept_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if new.swept_at is not null and (
    new.due_at is distinct from old.due_at
    or (new.state in ('accepted', 'waived') and old.state not in ('accepted', 'waived'))
  ) then
    new.swept_at := null;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.client_gate(p_project_id uuid, p_client_visible boolean DEFAULT true, p_require_client_role boolean DEFAULT true, p_require_project_visible boolean DEFAULT true, p_require_portal_enabled boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select
    (not p_require_client_role or public.is_project_client(p_project_id))
    and (not p_require_project_visible or public.is_project_visible_to(p_project_id))
    and (not p_require_portal_enabled or public.is_project_portal_enabled(p_project_id))
    and coalesce(p_client_visible, false);
$function$
;

CREATE OR REPLACE FUNCTION public.client_requests_sync_decision_from_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_request record;
begin
  if NEW.decision_type <> 'commercial' or NEW.subject_type <> 'artifact' then
    return NEW;
  end if;
  if OLD.state = NEW.state then
    return NEW;
  end if;
  if NEW.state not in ('approved', 'changes_requested') then
    return NEW;
  end if;

  select cr.id, cr.project_id, cr.title, cr.body, cr.origin_assumption_id
    into v_request
    from public.client_requests cr
   where cr.id = NEW.subject_id
     and cr.approval_request_id = NEW.id;

  if v_request.id is null then
    return NEW;
  end if;

  perform set_config('app.client_requests_triage_guard_bypass', 'on', true);

  update public.client_requests
     set client_decision = case when NEW.state = 'approved' then 'approved' else 'rejected' end,
         decided_by = NEW.decided_by,
         decided_at = NEW.decided_at
   where id = v_request.id;

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

  if NEW.state = 'approved' then
    insert into public.project_scope_items (
      project_id, title, description, included, source, change_request_id
    )
    values (
      v_request.project_id, v_request.title, v_request.body, true, 'change_request', v_request.id
    )
    on conflict (change_request_id)
      where (source = 'change_request' and change_request_id is not null)
      do nothing;

    -- F016j: added the project predicate. origin_assumption_id is a
    -- client-authored value at INSERT (until this migration's guard
    -- below closes that); without pinning the update to the SAME
    -- project as the request being approved, a foreign
    -- project_assumptions row could be invalidated by a client who
    -- never had visibility into it.
    if v_request.origin_assumption_id is not null then
      update public.project_assumptions
         set state = 'invalidated'
       where id = v_request.origin_assumption_id
         and project_id = v_request.project_id
         and state <> 'invalidated';
    end if;
  end if;

  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_channel_atomic(p_workspace_id uuid, p_kind text, p_created_by uuid, p_member_ids uuid[], p_project_id uuid DEFAULT NULL::uuid, p_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_channel_id uuid;
  v_caller_role text;
  v_missing_member_id uuid;
begin
  if auth.uid() is not null then
    if p_created_by is distinct from auth.uid() then
      raise exception 'create_channel_atomic: p_created_by must match the authenticated caller'
        using errcode = '42501';
    end if;

    select wm.role into v_caller_role
      from workspace_members wm
     where wm.workspace_id = p_workspace_id
       and wm.user_id = auth.uid()
       and wm.status = 'active';

    if v_caller_role is null or v_caller_role = 'client' then
      raise exception 'create_channel_atomic: caller is not an active non-client member of this workspace'
        using errcode = '42501';
    end if;

    select member_id into v_missing_member_id
      from unnest(p_member_ids) as member_id
     where not exists (
       select 1 from workspace_members wm2
        where wm2.workspace_id = p_workspace_id
          and wm2.user_id = member_id
          and wm2.status = 'active'
     )
     limit 1;

    if v_missing_member_id is not null then
      raise exception 'create_channel_atomic: every member must be an active member of this workspace'
        using errcode = '42501';
    end if;
  end if;

  insert into channels (workspace_id, project_id, kind, name, created_by)
  values (p_workspace_id, p_project_id, p_kind, p_name, p_created_by)
  returning id into v_channel_id;

  insert into channel_members (channel_id, user_id)
  select v_channel_id, member_id
    from unnest(p_member_ids) as member_id;

  return v_channel_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_notification(p_user_id uuid, p_workspace_id uuid, p_kind text, p_actor_id uuid DEFAULT NULL::uuid, p_task_id uuid DEFAULT NULL::uuid, p_comment_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb, p_system boolean DEFAULT false)
 RETURNS notifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.notifications;
  v_actor uuid;
begin
  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = p_user_id
      and wm.status = 'active'
  ) then
    raise exception 'create_notification: recipient % is not an active member of workspace %', p_user_id, p_workspace_id;
  end if;

  -- F320: a provided task_id must belong to a project inside the target
  -- workspace -- prevents a notification whose task_id and workspace_id
  -- disagree about which workspace they belong to.
  if p_task_id is not null then
    if not exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = p_task_id
        and p.workspace_id = p_workspace_id
    ) then
      raise exception 'create_notification: task % does not belong to workspace %', p_task_id, p_workspace_id;
    end if;
  end if;

  -- A system-generated notification is only exempt from the caller
  -- auth/membership checks when the caller genuinely has no user session
  -- at all (a real service-role/cron/backend caller, e.g. F212's overdue
  -- sweep). A caller claiming p_system => true while holding a real
  -- auth.uid() (any `authenticated`-role client session) is NOT exempt --
  -- it falls through to the same checks as a normal, human-attributed
  -- call, so passing p_system => true can no longer be used to skip the
  -- caller-membership check or forge a "System" notification.
  if p_system and auth.uid() is null then
    -- System-generated notification (e.g. F212's overdue sweep): no
    -- human session exists, so there is no actor and no caller
    -- membership to check.
    v_actor := null;
  else
    if auth.uid() is null then
      raise exception 'create_notification: no authenticated caller';
    end if;

    if not exists (
      select 1
      from public.workspace_members wm
      where wm.workspace_id = p_workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
    ) then
      raise exception 'create_notification: caller % is not an active member of workspace %', auth.uid(), p_workspace_id;
    end if;

    -- Never trust a client-supplied actor id: pin it to the caller's
    -- own session, regardless of what p_actor_id was passed.
    v_actor := auth.uid();
  end if;

  insert into public.notifications (
    user_id, workspace_id, kind, actor_id, task_id, comment_id, payload
  )
  values (
    p_user_id, p_workspace_id, p_kind, v_actor, p_task_id, p_comment_id, coalesce(p_payload, '{}'::jsonb)
  )
  returning * into v_row;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_project_from_template(p_workspace_id uuid, p_name text, p_description text, p_created_by uuid, p_tasks jsonb, p_phases jsonb DEFAULT '[]'::jsonb, p_deliverables jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(project_id uuid, project_key text, project_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_project_id uuid;
  v_project_key text;
  v_task jsonb;
  v_task_id uuid;
  v_checklist jsonb;
  v_position double precision := 0;
  v_phase jsonb;
  v_phase_position integer := 0;
  v_deliverable jsonb;
  v_deliverable_position integer := 0;
begin
  insert into projects (workspace_id, name, description, created_by)
  values (p_workspace_id, p_name, p_description, p_created_by)
  returning id, key into v_project_id, v_project_key;

  for v_task in select * from jsonb_array_elements(coalesce(p_tasks, '[]'::jsonb))
  loop
    v_position := v_position + 1000;

    insert into tasks (
      project_id,
      title,
      description,
      description_json,
      status,
      priority,
      tags,
      estimate_minutes,
      author_id,
      position
    )
    values (
      v_project_id,
      v_task->>'title',
      v_task->>'description',
      v_task->'description_json',
      'todo',
      nullif(v_task->>'priority', ''),
      coalesce(
        (select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_task->'tags', '[]'::jsonb))),
        '{}'
      ),
      case
        when v_task->>'estimate_minutes' is null then null
        else (v_task->>'estimate_minutes')::integer
      end,
      p_created_by,
      v_position
    )
    returning id into v_task_id;

    for v_checklist in
      select * from jsonb_array_elements(coalesce(v_task->'checklistItems', '[]'::jsonb))
    loop
      insert into checklist_items (task_id, content, position)
      values (
        v_task_id,
        v_checklist->>'content',
        case
          when v_checklist->>'position' is null then 0
          else (v_checklist->>'position')::double precision
        end
      );
    end loop;
  end loop;

  for v_phase in select * from jsonb_array_elements(coalesce(p_phases, '[]'::jsonb))
  loop
    v_phase_position := v_phase_position + 1;

    insert into project_phases (
      project_id,
      name,
      client_description,
      client_visible,
      position
    )
    values (
      v_project_id,
      v_phase->>'name',
      v_phase->>'client_description',
      coalesce((v_phase->>'client_visible')::boolean, true),
      v_phase_position
    );
  end loop;

  for v_deliverable in select * from jsonb_array_elements(coalesce(p_deliverables, '[]'::jsonb))
  loop
    v_deliverable_position := v_deliverable_position + 1;

    insert into client_deliverables (
      project_id,
      title,
      description,
      kind,
      owner_name,
      due_at,
      blocking,
      position
    )
    values (
      v_project_id,
      v_deliverable->>'title',
      v_deliverable->>'description',
      v_deliverable->>'kind',
      v_deliverable->>'owner_name',
      case
        when v_deliverable->>'due_offset_days' is null then null
        else current_date + (v_deliverable->>'due_offset_days')::integer
      end,
      coalesce((v_deliverable->>'blocking')::boolean, false),
      v_deliverable_position
    );
  end loop;

  return query select v_project_id, v_project_key, p_name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_workspace_with_owner(p_name text, p_slug text)
 RETURNS TABLE(id uuid, slug text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_workspace_id uuid;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  insert into workspaces (name, slug)
  values (p_name, p_slug)
  returning workspaces.id into v_workspace_id;

  insert into workspace_members (workspace_id, user_id, role, status)
  values (v_workspace_id, v_user_id, 'owner', 'active');

  insert into task_types (workspace_id, name, color, position, system_key, is_billable, default_client_visible)
  values
    (v_workspace_id, 'Page', '#3670e1', 0, 'page', true, true),
    (v_workspace_id, 'Delivery', '#6b7280', 1000, 'delivery', true, false),
    (v_workspace_id, 'QA issue', '#ef4444', 2000, 'qa', false, false),
    (v_workspace_id, 'Client request', '#f59e0b', 3000, 'client_request', true, true),
    (v_workspace_id, 'Change request', '#8b5cf6', 4000, 'change_request', true, true),
    (v_workspace_id, 'Improvement', '#10b981', 5000, 'improvement', false, false)
  on conflict (workspace_id, system_key) where system_key is not null do nothing;

  return query select v_workspace_id, p_slug;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.decide_approval_atomic(p_request_id uuid, p_decision text, p_note text DEFAULT NULL::text)
 RETURNS TABLE(request_id uuid, state text, decided_at timestamp with time zone, resulting_task_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_decision_type text;
  v_subject_type text;
  v_subject_id uuid;
  v_state text;
  v_requested_by uuid;
  v_title text;
  v_phase_id uuid;
  v_decided_at timestamptz := now();
  v_task_project_id uuid;
  v_notify_task_id uuid;
  v_resulting_task_id uuid;
  v_status text;
  v_next_position double precision;
  v_task_type_id uuid;
  v_description text;
  v_decider_name text;
  v_subject_project_id uuid;
begin
  if v_user_id is null then
    raise exception 'decide_approval_atomic: not authenticated' using errcode = '28000';
  end if;

  if p_decision not in ('approved', 'changes_requested') then
    raise exception 'decide_approval_atomic: invalid decision %', p_decision using errcode = '22023';
  end if;

  if p_decision = 'changes_requested' and (p_note is null or btrim(p_note) = '') then
    raise exception 'decide_approval_atomic: a note is required when requesting changes' using errcode = '22023';
  end if;

  select ar.project_id, ar.decision_type, ar.subject_type, ar.subject_id,
         ar.state, ar.requested_by, ar.title, ar.phase_id
    into v_project_id, v_decision_type, v_subject_type, v_subject_id,
         v_state, v_requested_by, v_title, v_phase_id
    from approval_requests ar
   where ar.id = p_request_id
     for update of ar;

  if v_project_id is null then
    raise exception 'decide_approval_atomic: approval request not found' using errcode = 'P0002';
  end if;

  if v_state <> 'pending' then
    raise exception 'decide_approval_atomic: this request has already been decided' using errcode = '42501';
  end if;

  select p.workspace_id into v_workspace_id from projects p where p.id = v_project_id;
  if v_workspace_id is null then
    raise exception 'decide_approval_atomic: project not found' using errcode = 'P0002';
  end if;

  if v_subject_type = 'task' and v_subject_id is not null then
    select t.project_id into v_subject_project_id from tasks t where t.id = v_subject_id;
    if v_subject_project_id is distinct from v_project_id then
      raise exception 'decide_approval_atomic: approval request not found' using errcode = 'P0002';
    end if;
  elsif v_subject_type = 'doc' and v_subject_id is not null then
    select d.project_id into v_subject_project_id from docs d where d.id = v_subject_id;
    if v_subject_project_id is distinct from v_project_id then
      raise exception 'decide_approval_atomic: approval request not found' using errcode = 'P0002';
    end if;
  elsif v_subject_type = 'phase' and v_subject_id is not null then
    select pp.project_id into v_subject_project_id from project_phases pp where pp.id = v_subject_id;
    if v_subject_project_id is distinct from v_project_id then
      raise exception 'decide_approval_atomic: approval request not found' using errcode = 'P0002';
    end if;
  end if;

  -- F016d: portal_enabled routed through client_gate, both other flags
  -- turned off -- decision ownership is not client-restricted and is
  -- checked separately below via is_project_decision_owner.
  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'decide_approval_atomic: you are not the decision owner for this request' using errcode = '42501';
  end if;

  if not public.is_project_decision_owner(v_project_id, v_decision_type, v_user_id) then
    raise exception 'decide_approval_atomic: you are not the decision owner for this request' using errcode = '42501';
  end if;

  if p_decision = 'changes_requested' then
    select ps.name into v_status
      from project_statuses ps
     where ps.project_id = v_project_id
       and ps.category = 'not_started'
     order by ps.position
     limit 1;

    if v_status is null then
      select ps.name into v_status
        from project_statuses ps
       where ps.project_id = v_project_id
       order by ps.position
       limit 1;
    end if;

    select coalesce(max(t.position) + 1000, 1000) into v_next_position
      from tasks t
     where t.project_id = v_project_id
       and t.status = v_status
       and t.deleted_at is null;

    v_task_type_id := null;
    if v_subject_type = 'task' and v_subject_id is not null then
      select t.task_type_id into v_task_type_id from tasks t where t.id = v_subject_id;
    end if;

    select p.display_name into v_decider_name from profiles p where p.id = v_user_id;

    v_description := p_note
      || E'\n\n— requested by ' || coalesce(v_decider_name, 'the client')
      || ' on ' || to_char(v_decided_at, 'YYYY-MM-DD');

    insert into tasks (
      project_id, phase_id, title, description, status, task_type_id,
      assignee_id, author_id, position, client_visible
    ) values (
      v_project_id, v_phase_id, 'Changes requested: ' || v_title, v_description,
      v_status, v_task_type_id, v_requested_by, v_user_id, v_next_position, false
    )
    returning id into v_resulting_task_id;

    if v_subject_type = 'task' and v_subject_id is not null then
      insert into comments (task_id, user_id, text)
      values (v_subject_id, v_user_id, 'Requested changes: ' || p_note);
    end if;
  end if;

  update approval_requests
     set state = p_decision,
         decided_by = v_user_id,
         decided_at = v_decided_at,
         decision_note = p_note,
         resulting_task_id = v_resulting_task_id
   where id = p_request_id;

  v_notify_task_id := null;
  if v_subject_type = 'task' and v_subject_id is not null then
    update tasks
       set pending_client_approval = false
     where id = v_subject_id;

    select t.project_id into v_task_project_id from tasks t where t.id = v_subject_id;
    if v_task_project_id = v_project_id then
      v_notify_task_id := v_subject_id;
    end if;
  end if;

  perform public.write_audit_log_entry(
    v_workspace_id,
    case when p_decision = 'approved' then 'approval_request.approved' else 'approval_request.changes_requested' end,
    'approval_request',
    p_request_id,
    jsonb_build_object(
      'decision_type', v_decision_type,
      'subject_type', v_subject_type,
      'subject_id', v_subject_id,
      'note', p_note,
      'resulting_task_id', v_resulting_task_id
    )
  );

  perform public.create_notification(
    p_user_id => v_requested_by,
    p_workspace_id => v_workspace_id,
    p_kind => 'approval_decided',
    p_actor_id => v_user_id,
    p_task_id => v_notify_task_id,
    p_comment_id => null,
    p_payload => jsonb_build_object(
      'request_id', p_request_id,
      'title', v_title,
      'decision', p_decision,
      'decision_type', v_decision_type,
      'resulting_task_id', v_resulting_task_id
    )
  );

  return query select p_request_id, p_decision, v_decided_at, v_resulting_task_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.derive_project_key_base(p_name text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  words text[];
  w text;
  first_letter text;
  initials text := '';
  letters_only text;
  base text;
begin
  words := regexp_split_to_array(btrim(coalesce(p_name, '')), '\s+');

  foreach w in array words loop
    first_letter := substr(upper(regexp_replace(w, '[^A-Za-z]', '', 'g')), 1, 1);
    if first_letter <> '' then
      initials := initials || first_letter;
    end if;
    exit when length(initials) >= 6;
  end loop;

  if length(initials) >= 2 then
    return left(initials, 6);
  end if;

  letters_only := upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z]', '', 'g'));

  if length(letters_only) = 0 then
    base := 'PRJ';
  elsif length(letters_only) = 1 then
    base := letters_only || 'X';
  else
    base := left(letters_only, 6);
  end if;

  return base;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.duplicate_task_atomic(p_source_task_id uuid, p_new_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if auth.uid() is not null then
    if not public.is_task_workspace_writer(p_source_task_id) then
      raise exception 'duplicate_task_atomic: caller does not have write access to the source task'
        using errcode = '42501';
    end if;

    if not public.is_project_visible_to(
      (select t.project_id from public.tasks t where t.id = p_source_task_id)
    ) then
      raise exception 'duplicate_task_atomic: caller does not have access to this task''s project'
        using errcode = '42501';
    end if;
  end if;

  insert into public.checklist_items (task_id, content, position)
  select p_new_task_id, content, position
  from public.checklist_items
  where task_id = p_source_task_id;

  insert into public.task_assignees (task_id, user_id, assigned_by)
  select p_new_task_id, user_id, assigned_by
  from public.task_assignees
  where task_id = p_source_task_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_client_requests_triage_columns_immutable_by_author()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_insert_allow constant text[] := array['id', 'project_id', 'created_by', 'created_at', 'updated_at', 'title', 'body', 'desired_by'];
  v_update_allow constant text[] := array['title', 'body', 'desired_by'];
  v_default_cols text;
  v_default_row public.client_requests;
  v_new_diff jsonb;
  v_ref_diff jsonb;
  v_key text;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if coalesce(current_setting('app.client_requests_triage_guard_bypass', true), 'off') = 'on' then
    return new;
  end if;

  -- Only the row's own author is restricted by this trigger. The
  -- team's triage/quote/decision writes go through RLS's writer-only
  -- policy or a SECURITY DEFINER RPC, neither of which is
  -- `new.created_by = auth.uid()` (F016's own design: a request is
  -- always authored by a client, triaged by someone else -- see
  -- 20261003010000's raise_change_request_from_assumption_atomic
  -- header for why that invariant is load-bearing).
  if new.created_by is distinct from auth.uid() then
    return new;
  end if;

  if TG_OP = 'INSERT' then
    -- Build the table's own current default for every column, computed
    -- from the catalog rather than hand-copied -- this is what makes
    -- the guard self-maintaining: a column added by a later migration
    -- gets a default entry here automatically, with no edit to this
    -- function required.
    select string_agg(
             coalesce(pg_get_expr(ad.adbin, ad.adrelid), 'NULL') || ' as ' || quote_ident(a.attname),
             ', '
           )
      into v_default_cols
      from pg_attribute a
      left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
     where a.attrelid = 'public.client_requests'::regclass
       and a.attnum > 0
       and not a.attisdropped;

    execute 'select ' || v_default_cols into v_default_row;

    v_new_diff := to_jsonb(new) - v_insert_allow;
    v_ref_diff := to_jsonb(v_default_row) - v_insert_allow;

    for v_key in select jsonb_object_keys(v_new_diff)
    loop
      if (v_new_diff -> v_key) is distinct from (v_ref_diff -> v_key) then
        raise exception 'client_requests: a request cannot be filed already carrying a value for % (author-write not allowed on this column)', v_key
          using errcode = '42501';
      end if;
    end loop;

    return new;
  end if;

  -- UPDATE
  v_new_diff := to_jsonb(new) - v_update_allow;
  v_ref_diff := to_jsonb(old) - v_update_allow;

  for v_key in select jsonb_object_keys(v_new_diff)
  loop
    if (v_new_diff -> v_key) is distinct from (v_ref_diff -> v_key) then
      raise exception 'client_requests: the request''s own author cannot change % after filing it', v_key
        using errcode = '42501';
    end if;
  end loop;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_comment_edit_author_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Service-role callers (the admin client used by every Server Action in
  -- lib/actions/comments.ts) are exempt: authorship/permissions have
  -- already been re-verified server-side before this UPDATE is issued.
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- Authorship can never be reassigned via a direct UPDATE, by anyone,
  -- regardless of which columns are also changing in the same statement.
  -- This closes the two-step "set user_id to self, then rewrite body"
  -- takeover: step 1 alone (a bare user_id change) is now rejected
  -- outright, so there is no window in which OLD.user_id has already
  -- become the attacker's own id before the body-change guard below ever
  -- runs.
  if new.user_id is distinct from old.user_id then
    raise exception 'Comment authorship cannot be reassigned'
      using errcode = '42501';
  end if;

  if (
    new.body_text is distinct from old.body_text
    or new.body_json is distinct from old.body_json
    or new.text is distinct from old.text
    or new.edited_at is distinct from old.edited_at
  ) and auth.uid() is distinct from old.user_id then
    raise exception 'Only the comment author may edit its content'
      using errcode = '42501';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_project_visibility_change_role()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.visibility is distinct from old.visibility and auth.role() <> 'service_role' then
    if not exists (
      select 1
      from workspace_members wm
      where wm.workspace_id = new.workspace_id
        and wm.user_id = auth.uid()
        and wm.status = 'active'
        and wm.role in ('owner', 'admin')
    ) then
      raise exception 'Only workspace owners or admins can change a project''s visibility'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_projects_field_role_allowlist()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_identity_cols constant text[] := array['id', 'workspace_id', 'created_at', 'updated_at', 'created_by'];
  v_member_cols constant text[] := array['name', 'description', 'start_date', 'end_date'];
  v_writer_cols constant text[] := array['target_launch_date', 'launch_confidence', 'launch_note', 'warranty_until', 'warranty_terms', 'baseline_frozen_at'];
  v_owner_admin_cols constant text[] := array['portal_enabled', 'portal_enabled_at', 'visibility', 'deleted_at', 'archived_by'];
  v_named_cols text[];
  v_is_writer boolean;
  v_is_owner_admin boolean;
  v_default_cols text;
  v_default_row public.projects;
  v_new_diff jsonb;
  v_ref_diff jsonb;
  v_key text;
  v_col text;
  v_writer_touched boolean := false;
  v_owner_admin_touched boolean := false;
  v_key_bypass boolean := false;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  -- F025c/F025d: transaction-local bypass for the application's own
  -- SECURITY DEFINER trigger writes -- assign_task_number()'s
  -- task_counter bump (F025c, a separate UPDATE statement that
  -- legitimately skips this WHOLE guard for that one write) and
  -- assign_project_key()'s key generation (F025d, INSIDE this same
  -- INSERT statement, where every other column still needs checking on
  -- this row) -- matching F016j's client_requests_triage_guard_bypass
  -- technique. Never settable by a caller through RLS/PostgREST -- only
  -- a SECURITY DEFINER function body running server-side can call
  -- set_config with this name, and `true` (transaction-local) means it
  -- cannot leak past the enclosing transaction's commit/rollback.
  --
  -- The flag is self-consumed HERE (turned back "off" the instant it is
  -- observed "on"), not only by the writer that set it, because
  -- assign_project_key() (BEFORE INSERT, same row, same statement) has
  -- no later statement of its own in which to turn the flag back off
  -- before this guard trigger runs next in name order -- unlike
  -- assign_task_number()'s own separate UPDATE, which re-enters this
  -- guard from outside and can bracket it itself (that bracket's own
  -- "off" afterward becomes a harmless no-op here).
  --
  -- F025d: the two legitimate setters of this flag are told apart by
  -- TG_OP, which is safe because each only ever fires the operation
  -- named here -- assign_task_number() sets the flag around its own
  -- UPDATE on projects (this guard's TG_OP = 'UPDATE' branch) and
  -- assign_project_key() sets it inside a BEFORE INSERT trigger on
  -- projects (TG_OP = 'INSERT'):
  --   - TG_OP = 'UPDATE': an early `return new` is correct and
  --     unchanged from F025c -- assign_task_number()'s write is a
  --     wholly separate statement re-entering this guard from outside,
  --     and no other column of the row it targets is being changed by
  --     that statement, so skipping the whole guard for it is safe.
  --   - TG_OP = 'INSERT': recorded into v_key_bypass instead, because
  --     assign_project_key()'s write shares this exact row and
  --     statement with every other column the guard still must check
  --     (a client inserting `baseline_frozen_at` alongside a project
  --     with no explicit `key` still needs to be rejected) -- an early
  --     `return new` here was tried and rejected during this fix; see
  --     this migration's own header for why.
  if coalesce(current_setting('app.projects_field_guard_bypass', true), 'off') = 'on' then
    perform set_config('app.projects_field_guard_bypass', 'off', true);
    if TG_OP = 'UPDATE' then
      return new;
    end if;
    v_key_bypass := true;
  end if;

  v_named_cols := v_identity_cols || v_member_cols || v_writer_cols || v_owner_admin_cols;
  if v_key_bypass then
    v_named_cols := v_named_cols || array['key'];
  end if;

  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role not in ('viewer', 'client')
  ) into v_is_writer;

  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = new.workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  ) into v_is_owner_admin;

  if TG_OP = 'INSERT' then
    select string_agg(
             coalesce(pg_get_expr(ad.adbin, ad.adrelid), 'NULL') || ' as ' || quote_ident(a.attname),
             ', '
           )
      into v_default_cols
      from pg_attribute a
      left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
     where a.attrelid = 'public.projects'::regclass
       and a.attnum > 0
       and not a.attisdropped;

    execute 'select ' || v_default_cols into v_default_row;

    v_new_diff := to_jsonb(new) - v_named_cols;
    v_ref_diff := to_jsonb(v_default_row) - v_named_cols;

    for v_key in select jsonb_object_keys(v_new_diff)
    loop
      if (v_new_diff -> v_key) is distinct from (v_ref_diff -> v_key) then
        raise exception 'projects: a project cannot be created already carrying a value for % (not an allow-listed column)', v_key
          using errcode = '42501';
      end if;
    end loop;

    foreach v_col in array v_writer_cols
    loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(v_default_row) -> v_col) then
        v_writer_touched := true;
      end if;
    end loop;

    foreach v_col in array v_owner_admin_cols
    loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(v_default_row) -> v_col) then
        v_owner_admin_touched := true;
      end if;
    end loop;
  else
    v_new_diff := to_jsonb(new) - v_named_cols;
    v_ref_diff := to_jsonb(old) - v_named_cols;

    for v_key in select jsonb_object_keys(v_new_diff)
    loop
      if (v_new_diff -> v_key) is distinct from (v_ref_diff -> v_key) then
        raise exception 'projects: % cannot be changed directly (not an allow-listed column)', v_key
          using errcode = '42501';
      end if;
    end loop;

    foreach v_col in array v_writer_cols
    loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
        v_writer_touched := true;
      end if;
    end loop;

    foreach v_col in array v_owner_admin_cols
    loop
      if (to_jsonb(new) -> v_col) is distinct from (to_jsonb(old) -> v_col) then
        v_owner_admin_touched := true;
      end if;
    end loop;
  end if;

  if v_writer_touched and not v_is_writer then
    raise exception 'Only workspace members with write access can change a project''s launch, warranty or baseline-freeze fields'
      using errcode = '42501';
  end if;

  if v_owner_admin_touched and not v_is_owner_admin then
    raise exception 'Only workspace owners or admins can change a project''s portal, visibility or archive fields'
      using errcode = '42501';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_task_dependency_no_cycle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_workspace_id uuid;
  v_would_cycle boolean;
begin
  -- Resolve the workspace independently of the AS-285 same-workspace
  -- trigger (F155's `task_dependencies_enforce_same_workspace`) — trigger
  -- firing order between two BEFORE INSERT triggers on one table is not
  -- something this migration relies on. If the blocking task doesn't
  -- resolve to a real workspace, there is nothing to lock or check;
  -- let the insert proceed to whatever other constraint/trigger rejects
  -- a nonexistent task.
  select p.workspace_id
    into v_workspace_id
    from tasks t
    join projects p on p.id = t.project_id
    where t.id = new.blocking_task_id;

  if v_workspace_id is null then
    return new;
  end if;

  -- Concurrency mechanism: serialize every dependency insert for this
  -- workspace behind one transaction-scoped advisory lock before doing
  -- any cycle reasoning. See the header comment above for exactly why
  -- this closes the TOCTOU race a plain pre-insert SELECT cannot.
  perform pg_advisory_xact_lock(hashtextextended(v_workspace_id::text, 0));

  -- Now that no concurrent dependency write for this workspace can be
  -- in flight, walk the existing edges outward from the task that would
  -- become blocked, to see whether it can already reach the task that
  -- would become blocking. If it can, the new edge closes a loop.
  with recursive reachable(task_id) as (
    select blocked_task_id
      from task_dependencies
      where blocking_task_id = new.blocked_task_id
    union
    select td.blocked_task_id
      from task_dependencies td
      join reachable r on td.blocking_task_id = r.task_id
  )
  select exists (
    select 1 from reachable where task_id = new.blocking_task_id
  )
  into v_would_cycle;

  if v_would_cycle then
    raise exception
      'task_dependency_cycle: task % already (directly or transitively) blocks task %, so it cannot also be blocked by it',
      new.blocked_task_id, new.blocking_task_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_task_dependency_same_workspace()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_blocking_workspace_id uuid;
  v_blocked_workspace_id uuid;
begin
  select p.workspace_id
    into v_blocking_workspace_id
    from tasks t
    join projects p on p.id = t.project_id
    where t.id = new.blocking_task_id;

  if v_blocking_workspace_id is null then
    raise exception 'blocking task % does not exist', new.blocking_task_id;
  end if;

  select p.workspace_id
    into v_blocked_workspace_id
    from tasks t
    join projects p on p.id = t.project_id
    where t.id = new.blocked_task_id;

  if v_blocked_workspace_id is null then
    raise exception 'blocked task % does not exist', new.blocked_task_id;
  end if;

  if v_blocking_workspace_id <> v_blocked_workspace_id then
    raise exception
      'a task dependency cannot cross workspaces (blocking task workspace %, blocked task workspace %)',
      v_blocking_workspace_id, v_blocked_workspace_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_task_parent_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_parent_project_id uuid;
  v_parent_parent_id uuid;
begin
  if new.parent_task_id is not null then
    -- Redundant with tasks_parent_not_self, kept here so this trigger's
    -- error message is specific even if called in a context where the
    -- CHECK hasn't fired yet.
    if new.parent_task_id = new.id then
      raise exception 'a task cannot be its own parent';
    end if;

    select project_id, parent_task_id
      into v_parent_project_id, v_parent_parent_id
      from tasks
      where id = new.parent_task_id;

    if v_parent_project_id is null then
      raise exception 'parent task % does not exist', new.parent_task_id;
    end if;

    -- AS-266 + AS-265 (cycle rejection): the proposed parent must itself
    -- be a top-level task (no parent of its own). Nesting deeper than one
    -- level, and every multi-node cycle, is rejected here.
    if v_parent_parent_id is not null then
      raise exception
        'nesting is limited to one level: task % already has a parent and cannot be used as a parent itself',
        new.parent_task_id;
    end if;

    -- Parent and child must belong to the same project (feature spec,
    -- enforced in the database, not only in the Server Action layer).
    if v_parent_project_id <> new.project_id then
      raise exception 'parent and child tasks must belong to the same project';
    end if;

    -- AS-266, the other direction: this task cannot already be a parent
    -- of other (live) tasks if it is now being given a parent itself —
    -- that would produce a 3-level chain (grandparent -> this -> its
    -- existing children).
    if exists (
      select 1 from tasks
      where parent_task_id = new.id
        and deleted_at is null
    ) then
      raise exception
        'task % already has children and cannot be assigned a parent (nesting is limited to one level)',
        new.id;
    end if;
  end if;

  -- Same-project rule, other direction: a task that is currently used as
  -- a parent cannot be moved to a different project out from under its
  -- children (would silently break the "parent and child share a
  -- project" invariant for the existing children without touching their
  -- own rows).
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    if exists (
      select 1 from tasks
      where parent_task_id = new.id
        and deleted_at is null
    ) then
      raise exception
        'task % has children and cannot be moved to a different project',
        new.id;
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_project_channel_atomic(p_project_id uuid, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_channel_id uuid;
  v_workspace_id uuid;
  v_project_name text;
begin
  select workspace_id, name
    into v_workspace_id, v_project_name
    from projects
    where id = p_project_id
      and deleted_at is null;

  if v_workspace_id is null then
    raise exception 'ensure_project_channel_atomic: project % not found', p_project_id;
  end if;

  insert into channels (workspace_id, project_id, kind, name, created_by)
  values (v_workspace_id, p_project_id, 'channel', coalesce(v_project_name, 'Project'), p_created_by)
  on conflict (project_id) where (kind = 'channel' and project_id is not null)
  do nothing;

  select id into v_channel_id
    from channels
    where project_id = p_project_id
      and kind = 'channel'
    limit 1;

  insert into channel_members (channel_id, user_id)
  select v_channel_id, pm.user_id
    from project_members pm
    where pm.project_id = p_project_id
  on conflict (channel_id, user_id) do nothing;

  return v_channel_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.ensure_task_type(p_workspace_id uuid, p_system_key text, p_name text, p_color text, p_is_billable boolean, p_default_client_visible boolean)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid;
begin
  select id into v_id
    from public.task_types
   where workspace_id = p_workspace_id
     and system_key = p_system_key;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.task_types (workspace_id, name, color, system_key, is_billable, default_client_visible)
  values (p_workspace_id, p_name, p_color, p_system_key, p_is_billable, p_default_client_visible)
  on conflict (workspace_id, system_key) where system_key is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id
      from public.task_types
     where workspace_id = p_workspace_id
       and system_key = p_system_key;
  end if;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.f016i_revoke_default_execute_on_create()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  obj record;
begin
  for obj in select * from pg_event_trigger_ddl_commands() loop
    if obj.object_type = 'function' and obj.schema_name = 'public' then
      if not exists (
        select 1 from public.f016i_gated_function_oids where oid = obj.objid
      ) then
        execute format(
          'revoke execute on function %s from public, anon, authenticated',
          obj.object_identity
        );
        insert into public.f016i_gated_function_oids (oid)
        values (obj.objid)
        on conflict do nothing;
      end if;
    end if;
  end loop;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.find_or_create_dm_channel_atomic(p_workspace_id uuid, p_user_a uuid, p_user_b uuid, p_created_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_low uuid := least(p_user_a, p_user_b);
  v_high uuid := greatest(p_user_a, p_user_b);
  v_channel_id uuid;
begin
  if p_user_a = p_user_b then
    raise exception 'find_or_create_dm_channel_atomic: cannot DM yourself';
  end if;

  select id into v_channel_id
    from channels
    where workspace_id = p_workspace_id
      and kind = 'dm'
      and dm_user_low = v_low
      and dm_user_high = v_high;

  if v_channel_id is not null then
    return v_channel_id;
  end if;

  insert into channels (workspace_id, kind, created_by, dm_user_low, dm_user_high)
  values (p_workspace_id, 'dm', p_created_by, v_low, v_high)
  on conflict (workspace_id, dm_user_low, dm_user_high) where (kind = 'dm')
  do nothing
  returning id into v_channel_id;

  if v_channel_id is null then
    -- Lost the insert race to a concurrent caller; the winner's row is now
    -- visible to this transaction.
    select id into v_channel_id
      from channels
      where workspace_id = p_workspace_id
        and kind = 'dm'
        and dm_user_low = v_low
        and dm_user_high = v_high;
  end if;

  insert into channel_members (channel_id, user_id)
  values (v_channel_id, p_user_a), (v_channel_id, p_user_b)
  on conflict (channel_id, user_id) do nothing;

  return v_channel_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.flag_assumption_atomic(p_assumption_id uuid, p_note text)
 RETURNS TABLE(assumption_id uuid, flagged_by_client_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_text text;
  v_state text;
  v_client_visible boolean;
  v_flagged_at timestamptz := now();
begin
  if v_user_id is null then
    raise exception 'flag_assumption_atomic: not authenticated' using errcode = '28000';
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'flag_assumption_atomic: a note is required' using errcode = '22023';
  end if;

  select pa.project_id, pa.text, pa.state, pa.client_visible
    into v_project_id, v_text, v_state, v_client_visible
    from project_assumptions pa
   where pa.id = p_assumption_id
     for update of pa;

  if v_project_id is null then
    raise exception 'flag_assumption_atomic: assumption not found' using errcode = 'P0002';
  end if;

  if not public.is_project_client(v_project_id) then
    raise exception 'flag_assumption_atomic: only a client of this project may flag an assumption' using errcode = '42501';
  end if;

  -- F016d/AS-046: one call, full gate — was three checks (visibility,
  -- portal_enabled) that had silently dropped the fourth
  -- (client_visible) the SELECT policy applies. The role check above
  -- stays separate (deliberately) because it raises its own distinct
  -- '42501' message rather than the generic 'not found' oracle every
  -- other branch here uses -- collapsing it into client_gate would lose
  -- that distinction for no gain, since client_gate returns only a
  -- boolean.
  if not public.client_gate(v_project_id, v_client_visible) then
    raise exception 'flag_assumption_atomic: assumption not found' using errcode = 'P0002';
  end if;

  select p.workspace_id into v_workspace_id from projects p where p.id = v_project_id;
  if v_workspace_id is null then
    raise exception 'flag_assumption_atomic: project not found' using errcode = 'P0002';
  end if;

  update project_assumptions
     set flagged_by_client_at = v_flagged_at,
         flagged_note = p_note
   where id = p_assumption_id;

  perform public.write_audit_log_entry(
    v_workspace_id,
    'project_assumption.flagged_by_client',
    'project_assumption',
    p_assumption_id,
    jsonb_build_object('project_id', v_project_id, 'note', p_note)
  );

  perform public.create_notification(
    p_user_id => wm.user_id,
    p_workspace_id => v_workspace_id,
    p_kind => 'assumption_flagged',
    p_actor_id => v_user_id,
    p_task_id => null,
    p_comment_id => null,
    p_payload => jsonb_build_object(
      'assumption_id', p_assumption_id,
      'project_id', v_project_id,
      'text', v_text,
      'note', p_note
    )
  )
  from workspace_members wm
  where wm.workspace_id = v_workspace_id
    and wm.status = 'active'
    and wm.role not in ('viewer', 'client');

  return query select p_assumption_id, v_flagged_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_due_recurring_occurrences()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_task record;
  v_next_due date;
  v_root_id uuid;
  v_new_id uuid;
  v_new_position double precision;
  v_generated_count integer := 0;
begin
  for v_task in
    select t.id, t.project_id, t.title, t.description, t.description_json,
           t.priority, t.estimate_minutes, t.due_date, t.author_id,
           t.recurrence, t.recurrence_parent_id, t.task_type_id
    from tasks t
    join projects p on p.id = t.project_id
    where t.recurrence is not null
      and t.due_date is not null
      -- gate on the task's OWN due_date having arrived, not the computed
      -- next date (fixed in 20260822161000; unchanged here).
      and t.due_date <= current_date
      and t.deleted_at is null
      and p.deleted_at is null
  loop
    v_next_due := public.recurrence_next_due_date(v_task.recurrence, v_task.due_date);

    -- No further occurrence -- invalid/malformed rule, or the series is
    -- exhausted (past `until`, AS-323).
    if v_next_due is null then
      continue;
    end if;

    -- Series root, never the immediately-due task -- same convention
    -- generate-next-occurrence.ts documents, so repeated generations
    -- across the same series all collide against ONE
    -- recurrence_parent_id value in the shared unique constraint.
    v_root_id := coalesce(v_task.recurrence_parent_id, v_task.id);

    select coalesce(max(position), 0) + 1000
      into v_new_position
      from tasks
      where project_id = v_task.project_id
        and status = 'todo'
        and deleted_at is null;

    v_new_id := null;

    -- Same idempotency guarantee AS-320/F177 already established:
    -- ON CONFLICT (recurrence_parent_id, due_date) DO NOTHING against
    -- tasks_recurrence_occurrence_idempotency.
    insert into tasks (
      project_id, title, description, description_json, status, priority,
      estimate_minutes, due_date, author_id, position, recurrence,
      recurrence_parent_id, task_type_id
    )
    values (
      v_task.project_id, v_task.title, v_task.description, v_task.description_json,
      'todo', v_task.priority, v_task.estimate_minutes, v_next_due, v_task.author_id,
      v_new_position, v_task.recurrence, v_root_id, v_task.task_type_id
    )
    on conflict (recurrence_parent_id, due_date) do nothing
    returning id into v_new_id;

    if v_new_id is null then
      continue;
    end if;

    -- F176's clone allow-list, ported: checklist items and assignees.
    insert into checklist_items (task_id, content, position)
    select v_new_id, ci.content, ci.position
    from checklist_items ci
    where ci.task_id = v_task.id
    order by ci.position;

    insert into task_assignees (task_id, user_id, assigned_by)
    select v_new_id, ta.user_id, v_task.author_id
    from task_assignees ta
    where ta.task_id = v_task.id;

    update tasks set last_occurrence_at = now() where id = v_root_id;

    -- F195 follow-up (AS-360): system-attributed task_activity entry for
    -- the newly generated occurrence, mirroring generate-next-occurrence
    -- .ts's own write exactly.
    begin
      perform public.write_task_activity_entry(
        p_task_id  := v_new_id,
        p_kind     := 'field_changed',
        p_field    := 'due_date',
        p_old_value := null,
        p_new_value := to_jsonb(v_next_due),
        p_system   := true
      );
    exception when others then
      raise warning
        'generate_due_recurring_occurrences: write_task_activity_entry failed for task % (non-fatal): %',
        v_new_id, sqlerrm;
    end;

    v_generated_count := v_generated_count + 1;
  end loop;

  return v_generated_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_unique_project_key(p_workspace_id uuid, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  base text;
  candidate text;
  suffix int := 1;
  suffix_text text;
  attempt int := 0;
  max_attempts int := 9000;
begin
  base := public.derive_project_key_base(p_name);
  candidate := base;

  while exists (
    select 1 from projects where workspace_id = p_workspace_id and key = candidate
  ) loop
    suffix := suffix + 1;
    suffix_text := suffix::text;
    candidate := left(base, greatest(2, 6 - length(suffix_text))) || suffix_text;
    attempt := attempt + 1;
    if attempt > max_attempts then
      raise exception
        'could not generate a unique project key for workspace % (base %)',
        p_workspace_id, base;
    end if;
  end loop;

  return candidate;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_blocked_count(p_workspace_id uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(distinct t.id)::bigint
  from active_project_tasks t
  join task_dependencies td on td.blocked_task_id = t.id
  join tasks blocking on blocking.id = td.blocking_task_id
  where t.project_workspace_id = p_workspace_id
    and not public.is_done_status(t.status_id, t.status)
    and blocking.deleted_at is null
    and not public.is_done_status(blocking.status_id, blocking.status);
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_channel_summaries(p_channel_ids uuid[])
 RETURNS TABLE(channel_id uuid, last_message_at timestamp with time zone, unread_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with my_channels as (
    -- Only channels that are BOTH in the caller-supplied list AND ones the
    -- caller is actually a member of. This is the access boundary: a
    -- caller cannot read another user's unread state by passing arbitrary
    -- channel ids, because last_read_at is always taken from the caller's
    -- OWN channel_members row (auth.uid()), and channels outside their own
    -- membership never appear in this CTE at all.
    select cm.channel_id, cm.last_read_at
    from public.channel_members cm
    where cm.user_id = auth.uid()
      and cm.channel_id = any(p_channel_ids)
  ),
  latest as (
    select distinct on (m.channel_id)
      m.channel_id,
      m.created_at as last_message_at
    from public.messages m
    join my_channels mc on mc.channel_id = m.channel_id
    where m.deleted_at is null
    order by m.channel_id, m.created_at desc
  ),
  unread as (
    select m.channel_id, count(*) as unread_count
    from public.messages m
    join my_channels mc on mc.channel_id = m.channel_id
    where m.deleted_at is null
      and m.created_at > mc.last_read_at
    group by m.channel_id
  )
  select
    mc.channel_id,
    latest.last_message_at,
    coalesce(unread.unread_count, 0) as unread_count
  from my_channels mc
  left join latest on latest.channel_id = mc.channel_id
  left join unread on unread.channel_id = mc.channel_id
$function$
;

CREATE OR REPLACE FUNCTION public.get_completed_count(p_workspace_id uuid, p_timezone text DEFAULT 'UTC'::text, p_days integer DEFAULT 7)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::bigint
  from active_project_tasks t
  where t.project_workspace_id = p_workspace_id
    and public.is_done_status(t.status_id, t.status)
    and t.updated_at >= (now() AT TIME ZONE p_timezone)::date - p_days;
$function$
;

CREATE OR REPLACE FUNCTION public.get_dependency_ancestors(p_task_id uuid)
 RETURNS TABLE(task_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with recursive ancestors(task_id) as (
    select blocking_task_id
      from task_dependencies
      where blocked_task_id = p_task_id
    union
    select td.blocking_task_id
      from task_dependencies td
      join ancestors a on td.blocked_task_id = a.task_id
  )
  select task_id from ancestors;
$function$
;

CREATE OR REPLACE FUNCTION public.get_dependency_descendants(p_task_id uuid)
 RETURNS TABLE(task_id uuid)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with recursive descendants(task_id) as (
    select blocked_task_id
      from task_dependencies
      where blocking_task_id = p_task_id
    union
    select td.blocked_task_id
      from task_dependencies td
      join descendants d on td.blocking_task_id = d.task_id
  )
  select task_id from descendants;
$function$
;

CREATE OR REPLACE FUNCTION public.get_due_soon_count(p_workspace_id uuid, p_timezone text DEFAULT 'UTC'::text, p_days integer DEFAULT 7)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::bigint
  from active_project_tasks t
  where t.project_workspace_id = p_workspace_id
    and t.due_date is not null
    and t.due_date >= (now() AT TIME ZONE p_timezone)::date
    and t.due_date < (now() AT TIME ZONE p_timezone)::date + p_days
    and not public.is_done_status(t.status_id, t.status);
$function$
;

CREATE OR REPLACE FUNCTION public.get_open_task_counts(project_ids uuid[])
 RETURNS TABLE(project_id uuid, open_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    return;
  end if;

  return query
  select t.project_id, count(*)::bigint as open_count
  from tasks t
  join project_statuses ps on ps.id = t.status_id
  join projects p on p.id = t.project_id
  where t.project_id = any(project_ids)
    and t.deleted_at is null
    and ps.category != 'done'
    and public.is_active_workspace_member(p.workspace_id)
    and (
      (
        public.is_project_client(t.project_id)
        and public.is_project_portal_enabled(t.project_id)
        and t.client_visible
      )
      or (
        not public.is_project_client(t.project_id)
        and public.is_project_visible_to(t.project_id)
      )
    )
  group by t.project_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.get_overdue_count(p_workspace_id uuid, p_timezone text DEFAULT 'UTC'::text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select count(*)::bigint
  from active_project_tasks t
  where t.project_workspace_id = p_workspace_id
    and t.due_date < (now() AT TIME ZONE p_timezone)::date
    -- F222 (AS-410): category-aware, was `t.status <> 'done'`.
    and not public.is_done_status(t.status_id, t.status);
$function$
;

CREATE OR REPLACE FUNCTION public.get_person_time_by_project(p_user_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(project_id uuid, project_name text, total_minutes bigint, billable_minutes bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    p.id as project_id,
    p.name as project_name,
    coalesce(sum(te.minutes), 0)::bigint as total_minutes,
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  join projects p on p.id = t.project_id
  where te.user_id = p_user_id
    and t.deleted_at is null
    and te.entry_date between p_start_date and p_end_date
  group by p.id, p.name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_person_time_daily(p_user_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(entry_date date, total_minutes bigint, billable_minutes bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    te.entry_date,
    coalesce(sum(te.minutes), 0)::bigint as total_minutes,
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  where te.user_id = p_user_id
    and t.deleted_at is null
    and te.entry_date between p_start_date and p_end_date
  group by te.entry_date;
$function$
;

CREATE OR REPLACE FUNCTION public.get_priority_counts(p_workspace_id uuid)
 RETURNS TABLE(priority text, count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select priority, count(*)::bigint as count
  from active_project_tasks
  where project_workspace_id = p_workspace_id
  group by priority;
$function$
;

CREATE OR REPLACE FUNCTION public.get_project_board_tasks(p_project_id uuid)
 RETURNS TABLE(id uuid, title text, status text, priority text, assignee_id uuid, due_date date, "position" double precision, updated_at timestamp with time zone, number integer, project_key text, subtask_count bigint, checklist_total bigint, checklist_done bigint, child_total bigint, child_done bigint, open_blocker_count bigint, estimate_minutes integer, assignee_ids uuid[], recurrence jsonb, status_category text, tags text[], client_visible boolean, pending_client_approval boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    t.id,
    t.title,
    t.status,
    t.priority,
    t.assignee_id,
    t.due_date,
    t."position",
    t.updated_at,
    t.number,
    p.key as project_key,
    coalesce(child_agg.subtask_count, 0) as subtask_count,
    coalesce(checklist_agg.checklist_total, 0) as checklist_total,
    coalesce(checklist_agg.checklist_done, 0) as checklist_done,
    coalesce(child_agg.subtask_count, 0) as child_total,
    coalesce(child_agg.child_done, 0) as child_done,
    coalesce(blocker_agg.open_blocker_count, 0) as open_blocker_count,
    t.estimate_minutes,
    coalesce(assignee_agg.assignee_ids, array[]::uuid[]) as assignee_ids,
    t.recurrence,
    ts.category as status_category,
    coalesce(t.tags, array[]::text[]) as tags,
    -- F090 item 2: straight off the base table, same "coalesce at the
    -- SQL boundary, never a bare null" convention as `tags` immediately
    -- above -- both columns are `not null default false` already, so the
    -- coalesce is defence-in-depth rather than a real null case today.
    coalesce(t.client_visible, false) as client_visible,
    coalesce(t.pending_client_approval, false) as pending_client_approval
  from tasks t
  join projects p on p.id = t.project_id
  left join project_statuses ts on ts.id = t.status_id
  left join lateral (
    select
      count(*)::bigint as subtask_count,
      count(*) filter (where public.is_done_status(c.status_id, c.status))::bigint as child_done
    from tasks c
    where c.parent_task_id = t.id
      and c.deleted_at is null
  ) child_agg on true
  left join lateral (
    select
      count(*)::bigint as checklist_total,
      count(*) filter (where ci.is_checked)::bigint as checklist_done
    from checklist_items ci
    where ci.task_id = t.id
  ) checklist_agg on true
  left join lateral (
    select count(*)::bigint as open_blocker_count
    from task_dependencies td
    join tasks blocking on blocking.id = td.blocking_task_id
    where td.blocked_task_id = t.id
      and blocking.deleted_at is null
      and not public.is_done_status(blocking.status_id, blocking.status)
  ) blocker_agg on true
  left join lateral (
    select array_agg(ta.user_id order by ta.created_at asc, ta.user_id asc)
      as assignee_ids
    from task_assignees ta
    where ta.task_id = t.id
  ) assignee_agg on true
  where t.project_id = p_project_id
    and t.deleted_at is null
  order by t."position" asc;
$function$
;

CREATE OR REPLACE FUNCTION public.get_project_time_totals(p_project_id uuid)
 RETURNS TABLE(billable_minutes bigint, non_billable_minutes bigint, estimate_minutes bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes,
    coalesce(sum(te.minutes) filter (where not te.billable), 0)::bigint as non_billable_minutes,
    coalesce((
      select sum(t2.estimate_minutes)
      from tasks t2
      where t2.project_id = p_project_id
        and t2.deleted_at is null
    ), 0)::bigint as estimate_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  where t.project_id = p_project_id
    and t.deleted_at is null;
$function$
;

CREATE OR REPLACE FUNCTION public.get_status_counts(p_workspace_id uuid)
 RETURNS TABLE(name text, color text, category text, count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    coalesce(ps.name, t.status) as name,
    (array_agg(ps.color order by ps.id))[1] as color,
    (array_agg(ps.category::text order by ps.id))[1] as category,
    count(*)::bigint as count
  from active_project_tasks t
  left join project_statuses ps on ps.id = t.status_id
  where t.project_workspace_id = p_workspace_id
  group by coalesce(ps.name, t.status);
$function$
;

CREATE OR REPLACE FUNCTION public.get_users_by_ids(p_ids uuid[])
 RETURNS TABLE(id uuid, email text, raw_user_meta_data jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select u.id, u.email, u.raw_user_meta_data
  from auth.users u
  where u.id = any(p_ids);
$function$
;

CREATE OR REPLACE FUNCTION public.get_workspace_time_by_person(p_workspace_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(user_id uuid, billable_minutes bigint, non_billable_minutes bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    te.user_id,
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes,
    coalesce(sum(te.minutes) filter (where not te.billable), 0)::bigint as non_billable_minutes
  from time_entries te
  join active_project_tasks t on t.id = te.task_id
  where t.project_workspace_id = p_workspace_id
    and te.entry_date between p_start_date and p_end_date
  group by te.user_id;
$function$
;

CREATE OR REPLACE FUNCTION public.get_workspace_time_by_person_and_project(p_workspace_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(user_id uuid, project_id uuid, project_name text, billable_minutes bigint, non_billable_minutes bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select
    te.user_id,
    p.id as project_id,
    p.name as project_name,
    coalesce(sum(te.minutes) filter (where te.billable), 0)::bigint as billable_minutes,
    coalesce(sum(te.minutes) filter (where not te.billable), 0)::bigint as non_billable_minutes
  from time_entries te
  join tasks t on t.id = te.task_id
  join projects p on p.id = t.project_id
  where p.workspace_id = p_workspace_id
    and t.deleted_at is null
    and te.entry_date between p_start_date and p_end_date
  group by te.user_id, p.id, p.name;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (id, timezone)
  values (new.id, 'UTC')
  on conflict (id) do nothing;
  return new;
exception
  when others then
    raise warning 'handle_new_user: failed to create profile for user %: %', new.id, sqlerrm;
    return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user_notification_preferences()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_active_workspace_member(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_channel_member(target_channel_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from channel_members cm
    where cm.channel_id = target_channel_id
      and cm.user_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_done_status(p_status_id uuid, p_status text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(
    (select ps.category = 'done' from project_statuses ps where ps.id = p_status_id),
    p_status = 'done'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_client(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role = 'client'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_decision_owner(p_project_id uuid, p_decision_type text, p_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case
    when p_decision_type is null then exists (
      select 1
        from project_decision_owners pdo
       where pdo.project_id = p_project_id
         and pdo.user_id = p_user_id
    )
    else exists (
      select 1
        from project_decision_owners pdo
       where pdo.project_id = p_project_id
         and pdo.decision_type = p_decision_type
         and pdo.user_id = p_user_id
    )
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_lead_or_workspace_admin(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  )
  or exists (
    select 1
    from project_members pm
    where pm.project_id = target_project_id
      and pm.user_id = auth.uid()
      and pm.project_role = 'lead'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_portal_enabled(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(
    (select p.portal_enabled from projects p where p.id = target_project_id),
    false
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_visible_to(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        (
          wm.role not in ('guest', 'client')
          and (
            p.visibility = 'workspace'
            or wm.role in ('owner', 'admin')
          )
        )
        or exists (
          select 1
          from project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_visible_to_row(target_project_id uuid, target_workspace_id uuid, target_visibility text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        (
          wm.role not in ('guest', 'client')
          and (
            target_visibility = 'workspace'
            or wm.role in ('owner', 'admin')
          )
        )
        or exists (
          select 1
          from project_members pm
          where pm.project_id = target_project_id
            and pm.user_id = auth.uid()
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_workspace_admin(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from projects p
    where p.id = target_project_id
      and public.is_workspace_admin(p.workspace_id)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_workspace_member(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_workspace_writer(target_project_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from projects p
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where p.id = target_project_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and (
        wm.role not in ('viewer', 'guest', 'client')
        or (
          wm.role = 'guest'
          and exists (
            select 1
            from project_members pm
            where pm.project_id = p.id
              and pm.user_id = auth.uid()
          )
        )
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_task_client(target_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from tasks t
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role = 'client'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_task_visible_to(target_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from tasks t
    where t.id = target_task_id
      and public.is_project_visible_to(t.project_id)
      and (
        not public.is_project_client(t.project_id)
        or (t.client_visible and public.is_project_portal_enabled(t.project_id))
      )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_task_workspace_member(target_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from tasks t
    join projects p on p.id = t.project_id
    join workspace_members wm on wm.workspace_id = p.workspace_id
    where t.id = target_task_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_task_workspace_writer(target_task_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (
    select 1
    from tasks t
    where t.id = target_task_id
      and public.is_project_workspace_writer(t.project_id)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_valid_link_kind(kind text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select kind in (
    'staging', 'live', 'figma', 'sitemap', 'drive', 'webflow',
    'gtm', 'analytics', 'search_console', 'other'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_valid_timezone(tz text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
begin
  perform timestamp '2000-01-01 00:00:00' at time zone tz;
  return true;
exception
  when invalid_parameter_value then
    return false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role in ('owner', 'admin')
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_workspace_client(target_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
      and wm.role = 'client'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.looks_like_credential(value text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select value is not null and (
    value ~ '(?i)sk_[a-z0-9_]{10,}'
    or value ~ '(?i)pk_[a-z0-9_]{10,}'
    or value ~ '(?i)ghp_[a-z0-9_]{10,}'
    or value ~ '(?i)xox[a-z]-[a-z0-9-]{10,}'
    or value ~ '-----BEGIN'
    or value ~ '[A-Za-z0-9+/]{40,}={0,2}'
  );
$function$
;

CREATE OR REPLACE FUNCTION public.mark_deliverable_delivered_atomic(p_deliverable_id uuid)
 RETURNS TABLE(deliverable_id uuid, state text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_state text;
begin
  if v_user_id is null then
    raise exception 'mark_deliverable_delivered_atomic: not authenticated' using errcode = '28000';
  end if;

  select cd.project_id, cd.state
    into v_project_id, v_state
    from client_deliverables cd
   where cd.id = p_deliverable_id
     for update of cd;

  if v_project_id is null then
    raise exception 'mark_deliverable_delivered_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if not public.client_gate(v_project_id, p_require_client_role => false) then
    raise exception 'mark_deliverable_delivered_atomic: deliverable not found' using errcode = 'P0002';
  end if;

  if v_state in ('accepted', 'waived') then
    raise exception 'mark_deliverable_delivered_atomic: this item has already been accepted' using errcode = '42501';
  end if;

  update client_deliverables
     set state = 'delivered',
         delivered_at = now(),
         review_note = null
   where id = p_deliverable_id;

  return query select p_deliverable_id, 'delivered'::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_overdue_task_assignees()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row record;
  v_notified_count integer := 0;
begin
  for v_row in
    select t.id as task_id, t.title as task_title, t.due_date as due_date,
           p.id as project_id, p.workspace_id as workspace_id,
           ta.user_id as assignee_id
    from tasks t
    join projects p on p.id = t.project_id
    join task_assignees ta on ta.task_id = t.id
    join notification_preferences np on np.user_id = ta.user_id
    join workspace_members wm
      on wm.workspace_id = p.workspace_id
     and wm.user_id = ta.user_id
     and wm.status = 'active'
    where t.due_date is not null
      and t.due_date <= (now() at time zone 'utc')::date
      -- F222 (AS-410): category-aware, was `t.status <> 'done'`.
      and not public.is_done_status(t.status_id, t.status)
      and t.deleted_at is null
      and p.deleted_at is null
      and np.task_due_soon_in_app = true
      and not exists (
        select 1
        from notifications n
        where n.user_id = ta.user_id
          and n.task_id = t.id
          and n.kind = 'task_due_soon'
      )
  loop
    begin
      perform public.create_notification(
        p_user_id => v_row.assignee_id,
        p_workspace_id => v_row.workspace_id,
        p_kind => 'task_due_soon',
        p_actor_id => null,
        p_task_id => v_row.task_id,
        p_comment_id => null,
        p_payload => jsonb_build_object('task_title', v_row.task_title, 'due_date', v_row.due_date),
        p_system => true
      );

      v_notified_count := v_notified_count + 1;
    exception
      when others then
        raise warning
          'notify_overdue_task_assignees: failed to notify user % for task % (workspace %): % (%)',
          v_row.assignee_id, v_row.task_id, v_row.workspace_id, sqlerrm, sqlstate;
    end;
  end loop;

  return v_notified_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_approval_request_settled_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_allow constant text[] := array['updated_at', 'resulting_task_id'];
  v_new_diff jsonb;
  v_old_diff jsonb;
  v_key text;
begin
  if OLD.state <> 'pending' then
    v_new_diff := to_jsonb(NEW) - v_allow;
    v_old_diff := to_jsonb(OLD) - v_allow;

    for v_key in select jsonb_object_keys(v_new_diff)
    loop
      if (v_new_diff -> v_key) is distinct from (v_old_diff -> v_key) then
        raise exception 'approval_requests: a settled decision cannot be modified (id=%, state=%, column=%)', OLD.id, OLD.state, v_key
          using errcode = '42501';
      end if;
    end loop;
  end if;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_frozen_baseline_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_frozen_at timestamptz;
  v_project_id uuid;
  v_baseline_value numeric;
  v_baseline_at date;
  v_metric_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_project_id := OLD.project_id;
    v_baseline_value := OLD.baseline_value;
    v_baseline_at := OLD.baseline_at;
    v_metric_id := OLD.id;

    if v_baseline_value is not null or v_baseline_at is not null then
      select p.baseline_frozen_at into v_frozen_at from public.projects p where p.id = v_project_id;

      if v_frozen_at is not null then
        raise exception
          'project_metrics: baseline is frozen for this project and this metric cannot be deleted (metric_id=%, project_id=%)',
          v_metric_id, v_project_id
          using errcode = '42501';
      end if;
    end if;

    return OLD;
  end if;

  if NEW.baseline_value is distinct from OLD.baseline_value
     or NEW.baseline_at is distinct from OLD.baseline_at
     or NEW.direction is distinct from OLD.direction
  then
    select p.baseline_frozen_at
      into v_frozen_at
      from public.projects p
     where p.id = OLD.project_id;

    if v_frozen_at is not null then
      raise exception
        'project_metrics: baseline is frozen for this project and cannot be changed (metric_id=%, project_id=%)',
        OLD.id, OLD.project_id
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.prevent_last_project_status_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_remaining int;
begin
  -- The project itself is being deleted (this delete arrived via
  -- `ON DELETE CASCADE` from `projects`) — the parent row is already gone
  -- by the time this trigger fires, so there is no "leaving the project
  -- with zero columns" to guard against; the project itself won't exist
  -- to have any columns. Let the cascade proceed.
  if not exists (select 1 from projects where id = old.project_id) then
    return old;
  end if;

  select count(*) into v_remaining
  from project_statuses
  where project_id = old.project_id
    and id <> old.id;

  if v_remaining = 0 then
    raise exception 'A project must have at least one board column.'
      using errcode = 'P0001';
  end if;

  return old;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.project_current_budget_period(p_project_id uuid)
 RETURNS TABLE(period_start date, period_end date, has_other_periods boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_period_start date;
  v_period_end date;
  v_total_periods integer;
begin
  if not public.client_gate(p_project_id, p_require_client_role => true) then
    raise exception 'project_current_budget_period: not permitted' using errcode = '42501';
  end if;

  select count(*) into v_total_periods
  from project_budgets pb
  where pb.project_id = p_project_id;

  if v_total_periods = 0 then
    return;
  end if;

  -- The period covering today, if one exists. `project_budgets_no_overlap`
  -- guarantees at most one row can match.
  select pb.period_start, pb.period_end
  into v_period_start, v_period_end
  from project_budgets pb
  where pb.project_id = p_project_id
    and pb.period_start <= current_date
    and pb.period_end >= current_date;

  if v_period_start is null then
    -- No period covers today: fall back to the most recently ended one.
    -- (A project with only a future, not-yet-started budget falls back
    -- to the most recently started one instead, so it still gets a
    -- single, real period rather than none at all.)
    select pb.period_start, pb.period_end
    into v_period_start, v_period_end
    from project_budgets pb
    where pb.project_id = p_project_id
      and pb.period_end < current_date
    order by pb.period_end desc
    limit 1;

    if v_period_start is null then
      select pb.period_start, pb.period_end
      into v_period_start, v_period_end
      from project_budgets pb
      where pb.project_id = p_project_id
      order by pb.period_start desc
      limit 1;
    end if;
  end if;

  return query select v_period_start, v_period_end, v_total_periods > 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.project_hours_client(p_project_id uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_weekly jsonb;
  v_category jsonb;
  v_sold_minutes integer;
begin
  if not public.client_gate(p_project_id, p_require_client_role => true) then
    raise exception 'project_hours_client: not permitted' using errcode = '42501';
  end if;

  with billable_entries as (
    select te.entry_date, te.minutes, te.work_category
    from time_entries te
    join tasks t on t.id = te.task_id
    where t.project_id = p_project_id
      and t.deleted_at is null
      and te.billable
      and te.entry_date >= p_from
      and te.entry_date <= p_to
  ),
  weekly as (
    select
      to_char(entry_date, 'IYYY-"W"IW') as iso_week,
      sum(minutes)::integer as minutes
    from billable_entries
    group by 1
  ),
  weekly_cum as (
    select
      iso_week,
      minutes,
      sum(minutes) over (order by iso_week rows between unbounded preceding and current row) as cumulative_minutes
    from weekly
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'iso_week', iso_week,
        'minutes', minutes,
        'cumulative_minutes', cumulative_minutes
      )
      order by iso_week
    ),
    '[]'::jsonb
  )
  into v_weekly
  from weekly_cum;

  with billable_entries as (
    select te.minutes, te.work_category
    from time_entries te
    join tasks t on t.id = te.task_id
    where t.project_id = p_project_id
      and t.deleted_at is null
      and te.billable
      and te.entry_date >= p_from
      and te.entry_date <= p_to
  ),
  by_category as (
    select
      coalesce(work_category, 'uncategorised') as work_category,
      sum(minutes)::integer as minutes
    from billable_entries
    group by 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('work_category', work_category, 'minutes', minutes)
      order by work_category
    ),
    '[]'::jsonb
  )
  into v_category
  from by_category;

  select pb.sold_minutes
  into v_sold_minutes
  from project_budgets pb
  where pb.project_id = p_project_id
    and daterange(pb.period_start, pb.period_end, '[]') && daterange(p_from, p_to, '[]')
  order by pb.period_start desc
  limit 1;

  return jsonb_build_object(
    'weekly', v_weekly,
    'by_category', v_category,
    'sold_minutes', v_sold_minutes
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.project_hours_team(p_project_id uuid, p_from date, p_to date)
 RETURNS TABLE(entry_id uuid, user_id uuid, task_id uuid, task_title text, entry_date date, minutes integer, billable boolean, work_category text, note text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.is_project_visible_to(p_project_id) or public.is_project_client(p_project_id) then
    raise exception 'project_hours_team: not permitted' using errcode = '42501';
  end if;

  return query
  select
    te.id,
    te.user_id,
    te.task_id,
    t.title,
    te.entry_date,
    te.minutes,
    te.billable,
    te.work_category,
    te.note
  from time_entries te
  join tasks t on t.id = te.task_id
  where t.project_id = p_project_id
    and t.deleted_at is null
    and te.entry_date >= p_from
    and te.entry_date <= p_to
  order by te.entry_date, te.user_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_comment(p_comment_id uuid)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_deleted_at timestamptz;
begin
  select c.deleted_at into v_deleted_at
  from comments c
  where c.id = p_comment_id
  for update;

  if v_deleted_at is null then
    raise exception 'purge_comment: comment % is not in the trash (not soft-deleted) or does not exist', p_comment_id;
  end if;

  delete from comments where comments.id = p_comment_id;

  return query select p_comment_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.purge_task(p_task_id uuid)
 RETURNS TABLE(id uuid, attachment_paths text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_deleted_at timestamptz;
  v_paths text[];
  v_workspace_id uuid;
  v_caller_role text;
begin
  if auth.uid() is not null then
    select p.workspace_id
      into v_workspace_id
      from tasks t
      join projects p on p.id = t.project_id
     where t.id = p_task_id;

    if v_workspace_id is null then
      raise exception 'purge_task: task % is not in the trash (not soft-deleted) or does not exist', p_task_id
        using errcode = '42501';
    end if;

    select wm.role into v_caller_role
      from workspace_members wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = auth.uid()
       and wm.status = 'active';

    if v_caller_role is null or v_caller_role <> 'owner' then
      raise exception 'purge_task: only a workspace owner can permanently delete this item'
        using errcode = '42501';
    end if;
  end if;

  select t.deleted_at into v_deleted_at
  from tasks t
  where t.id = p_task_id
  for update;

  if v_deleted_at is null then
    raise exception 'purge_task: task % is not in the trash (not soft-deleted) or does not exist', p_task_id;
  end if;

  select coalesce(array_agg(a.file_url), array[]::text[])
    into v_paths
  from attachments a
  where a.task_id = p_task_id;

  delete from checklist_items where task_id = p_task_id;
  delete from comments where task_id = p_task_id;
  delete from active_timers where task_id = p_task_id;
  delete from time_entries where task_id = p_task_id;
  delete from attachments where task_id = p_task_id;

  delete from task_dependencies
    where blocking_task_id = p_task_id or blocked_task_id = p_task_id;
  delete from task_assignees where task_id = p_task_id;
  delete from task_watchers where task_id = p_task_id;

  update tasks set parent_task_id = null where parent_task_id = p_task_id;
  update tasks set deleted_via_task_id = null where deleted_via_task_id = p_task_id;

  delete from tasks where tasks.id = p_task_id;

  return query select p_task_id, v_paths;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.raise_change_request_from_assumption_atomic(p_assumption_id uuid)
 RETURNS TABLE(request_id uuid, project_id uuid, title text, body text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_text text;
  v_note text;
  v_state text;
  v_flagged_at timestamptz;
  v_caller_role text;
  v_client_id uuid;
  v_request_id uuid;
  v_title text;
  v_created_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: not authenticated'
      using errcode = '28000';
  end if;

  select pa.project_id, pa.text, pa.flagged_note, pa.state, pa.flagged_by_client_at, p.workspace_id
    into v_project_id, v_text, v_note, v_state, v_flagged_at, v_workspace_id
    from public.project_assumptions pa
    join public.projects p on p.id = pa.project_id
   where pa.id = p_assumption_id
     for update of pa;

  if v_project_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: assumption not found'
      using errcode = 'P0002';
  end if;

  select wm.role into v_caller_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_user_id
     and wm.status = 'active';

  if v_caller_role is null or v_caller_role = 'viewer' or v_caller_role = 'client' then
    raise exception 'caller does not have permission to review requests'
      using errcode = '42501';
  end if;

  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  if v_flagged_at is null or v_state <> 'assumed' then
    raise exception 'this assumption has not been flagged by the client'
      using errcode = 'CR050';
  end if;

  select wm.user_id into v_client_id
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.role = 'client'
     and wm.status = 'active'
   order by wm.user_id
   limit 1;

  if v_client_id is null then
    raise exception 'raise_change_request_from_assumption_atomic: no active client on this workspace'
      using errcode = 'P0002';
  end if;

  v_title := left(v_text, 200);

  -- F016j: wrap this insert in the same bypass flag every other
  -- legitimate writer of the guarded columns uses, so this function's
  -- exemption from the allow-list guard is explicit rather than
  -- incidental to created_by never equalling auth.uid() here.
  perform set_config('app.client_requests_triage_guard_bypass', 'on', true);

  insert into public.client_requests (
    project_id, created_by, title, body, kind, scope_verdict, origin_assumption_id
  )
  values (
    v_project_id, v_client_id, v_title, v_note, 'change', 'change_request', p_assumption_id
  )
  returning client_requests.id, client_requests.created_at into v_request_id, v_created_at;

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

  return query select v_request_id, v_project_id, v_title, v_note, v_created_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reassign_and_delete_project_status(p_source_status_id uuid, p_destination_status_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_source_project_id uuid;
  v_destination_project_id uuid;
  v_destination_name text;
begin
  if p_source_status_id = p_destination_status_id then
    raise exception 'The destination column must be different from the column being removed.'
      using errcode = '22023';
  end if;

  select project_id into v_source_project_id
  from project_statuses
  where id = p_source_status_id
  for update;

  if v_source_project_id is null then
    raise exception 'Column not found.'
      using errcode = 'P0002';
  end if;

  select project_id, name into v_destination_project_id, v_destination_name
  from project_statuses
  where id = p_destination_status_id;

  if v_destination_project_id is null then
    raise exception 'Destination column not found.'
      using errcode = 'P0002';
  end if;

  if v_destination_project_id <> v_source_project_id then
    raise exception 'The destination column must belong to the same project.'
      using errcode = '22023';
  end if;

  -- Move every task off the source column. Writing `status` (not just
  -- `status_id`) so `tasks.status` (still the live column every existing
  -- board/list/filter reader uses, per F218/F219) is updated in the SAME
  -- statement rather than relying on the sync trigger's status_id branch,
  -- which mirrors the existing write convention used everywhere else in
  -- this codebase (write status text, let the trigger derive status_id).
  update tasks
  set status = v_destination_name,
      status_id = p_destination_status_id
  where status_id = p_source_status_id;

  -- The `project_statuses_prevent_last_delete` trigger still applies here
  -- (AS-415) — if the source column was the project's last one, this
  -- delete is rejected and the whole transaction (including the task
  -- moves above) rolls back atomically.
  delete from project_statuses
  where id = p_source_status_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.recurrence_next_due_date(p_rule jsonb, p_from_date date)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare
  v_freq text;
  v_interval integer;
  v_until date;
  v_next date;
  v_next_month_start date;
  v_last_day_of_month date;
  v_source_day integer;
  v_clamped_day integer;
begin
  if p_rule is null or p_from_date is null then
    return null;
  end if;

  v_freq := p_rule->>'freq';

  begin
    v_interval := (p_rule->>'interval')::integer;
  exception when others then
    return null;
  end;

  if v_interval is null or v_interval <= 0 then
    return null;
  end if;

  v_until := null;
  if (p_rule ? 'until') and (p_rule->>'until') is not null then
    begin
      v_until := (p_rule->>'until')::date;
    exception when others then
      -- malformed `until` -- invalid input, matches next-date.ts.
      return null;
    end;
  end if;

  case v_freq
    when 'daily' then
      v_next := (p_from_date + (v_interval || ' days')::interval)::date;
    when 'every_n_days' then
      v_next := (p_from_date + (v_interval || ' days')::interval)::date;
    when 'weekly' then
      v_next := (p_from_date + ((v_interval * 7) || ' days')::interval)::date;
    when 'monthly' then
      v_next_month_start := (
        date_trunc('month', p_from_date) + (v_interval || ' months')::interval
      )::date;
      v_last_day_of_month := (
        v_next_month_start + interval '1 month' - interval '1 day'
      )::date;
      v_source_day := extract(day from p_from_date)::integer;
      v_clamped_day := least(v_source_day, extract(day from v_last_day_of_month)::integer);
      v_next := make_date(
        extract(year from v_next_month_start)::integer,
        extract(month from v_next_month_start)::integer,
        v_clamped_day
      );
    else
      return null;
  end case;

  if v_next is null then
    return null;
  end if;

  -- AS-323 (inclusive `until` boundary, same semantics next-date.ts
  -- documents): only a date strictly AFTER `until` is exhausted.
  if v_until is not null and v_next > v_until then
    return null;
  end if;

  return v_next;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.remove_workspace_member(p_membership_id uuid, p_workspace_id uuid)
 RETURNS TABLE(deleted boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role text;
  v_status text;
  v_remaining_owners int;
begin
  select role, status
    into v_role, v_status
    from public.workspace_members
   where id = p_membership_id
     and workspace_id = p_workspace_id
   for update;

  if not found then
    return query select false, 'not_found';
    return;
  end if;

  if v_status <> 'active' then
    return query select false, 'not_active';
    return;
  end if;

  if v_role = 'owner' then
    perform 1
      from public.workspace_members
     where workspace_id = p_workspace_id
       and role = 'owner'
       and status = 'active'
       for update;

    select count(*)
      into v_remaining_owners
      from public.workspace_members
     where workspace_id = p_workspace_id
       and role = 'owner'
       and status = 'active';

    if v_remaining_owners <= 1 then
      return query select false, 'sole_owner';
      return;
    end if;
  end if;

  delete from public.workspace_members
   where id = p_membership_id
     and workspace_id = p_workspace_id
     and status = 'active';

  return query select true, null::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.request_portal_task_changes_atomic(p_task_id uuid)
 RETURNS TABLE(task_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_project_id uuid;
  v_workspace_id uuid;
begin
  select a.project_id into v_project_id
    from public.assert_portal_task_actionable_by_client(p_task_id) a;

  select p.workspace_id into v_workspace_id
    from public.projects p
   where p.id = v_project_id;

  update tasks
     set pending_client_approval = false
   where id = p_task_id;

  -- Defect 1 fix: the one statement that actually distinguishes this
  -- function from approve_portal_task_atomic above. A future scrutiny
  -- pass (or a test) can now tell the two calls apart from their durable
  -- side effects alone, not merely from which RPC name was invoked.
  perform public.write_audit_log_entry(
    v_workspace_id,
    'task.changes_requested',
    'task',
    p_task_id,
    jsonb_build_object('project_id', v_project_id)
  );

  return query select p_task_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.restore_task_atomic(p_task_id uuid)
 RETURNS TABLE(id uuid, project_id uuid, status text, "position" double precision, status_was_reset boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_project_id uuid;
  v_current_status text;
  v_resolved_status text;
  v_status_was_reset boolean;
  v_last_position float8;
  v_new_position float8;
  v_known_statuses text[] := array['todo', 'in_progress', 'in_review', 'done'];
  v_child record;
  v_child_resolved_status text;
  v_child_last_position float8;
  v_child_position float8;
begin
  if auth.uid() is not null then
    if not public.is_task_workspace_writer(p_task_id) then
      raise exception 'restore_task_atomic: caller does not have write access to this task'
        using errcode = '42501';
    end if;

    if not public.is_project_visible_to(
      (select t.project_id from public.tasks t where t.id = p_task_id)
    ) then
      raise exception 'restore_task_atomic: caller does not have access to this task''s project'
        using errcode = '42501';
    end if;
  end if;

  select t.project_id, t.status
    into v_project_id, v_current_status
  from public.tasks t
  where t.id = p_task_id
    and t.deleted_at is not null
  for update;

  if v_project_id is null then
    return;
  end if;

  v_status_was_reset := not (v_current_status = any(v_known_statuses));
  v_resolved_status := case when v_status_was_reset then 'todo' else v_current_status end;

  select t."position"
    into v_last_position
  from public.tasks t
  where t.project_id = v_project_id
    and t.status = v_resolved_status
    and t.deleted_at is null
  order by t."position" desc
  limit 1;

  v_new_position := coalesce(v_last_position, 0) + 1000;

  update public.tasks
  set deleted_at = null,
      deleted_by = null,
      status = v_resolved_status,
      "position" = v_new_position
  where public.tasks.id = p_task_id;

  for v_child in
    select t.id, t.status
    from public.tasks t
    where t.deleted_via_task_id = p_task_id
      and t.deleted_at is not null
  loop
    v_child_resolved_status := case
      when v_child.status = any(v_known_statuses) then v_child.status
      else 'todo'
    end;

    select t."position"
      into v_child_last_position
    from public.tasks t
    where t.project_id = v_project_id
      and t.status = v_child_resolved_status
      and t.deleted_at is null
    order by t."position" desc
    limit 1;

    v_child_position := coalesce(v_child_last_position, 0) + 1000;

    update public.tasks
    set deleted_at = null,
        deleted_by = null,
        deleted_via_task_id = null,
        status = v_child_resolved_status,
        "position" = v_child_position
    where public.tasks.id = v_child.id;
  end loop;

  return query
  select p_task_id, v_project_id, v_resolved_status, v_new_position, v_status_was_reset;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.rpc_project_time_totals(p_project_id uuid)
 RETURNS TABLE(task_type_id uuid, task_type_name text, system_key text, is_billable boolean, tracked_minutes bigint, estimated_minutes bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_workspace_id uuid;
  v_visibility text;
  v_caller_role text;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select p.workspace_id, p.visibility into v_workspace_id, v_visibility
    from public.projects p
   where p.id = p_project_id
     and p.deleted_at is null;

  if v_workspace_id is null then
    raise exception 'project not found';
  end if;

  select wm.role into v_caller_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_user_id
     and wm.status = 'active';

  if v_caller_role is null then
    raise exception 'not a member of this workspace'
      using errcode = '42501';
  end if;

  if v_visibility <> 'workspace'
     and v_caller_role not in ('owner', 'admin')
     and not exists (
       select 1 from public.project_members pm
       where pm.project_id = p_project_id and pm.user_id = v_user_id
     ) then
    raise exception 'you do not have access to this project'
      using errcode = '42501';
  end if;

  return query
    select
      tt.id,
      tt.name,
      tt.system_key,
      tt.is_billable,
      coalesce(sum(te.minutes), 0)::bigint as tracked_minutes,
      coalesce(sum(t.estimate_minutes), 0)::bigint as estimated_minutes
    from public.task_types tt
    left join public.tasks t
      on t.task_type_id = tt.id
     and t.project_id = p_project_id
     and t.deleted_at is null
    left join public.time_entries te
      on te.task_id = t.id
    where tt.workspace_id = v_workspace_id
    group by tt.id, tt.name, tt.system_key, tt.is_billable
    having coalesce(sum(te.minutes), 0) > 0 or coalesce(sum(t.estimate_minutes), 0) > 0
       or exists (
         select 1 from public.tasks t2
         where t2.task_type_id = tt.id and t2.project_id = p_project_id and t2.deleted_at is null
       )
    order by tt.position;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.search_tasks(p_project_id uuid, p_query text)
 RETURNS SETOF tasks
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select *
  from tasks
  where project_id = p_project_id
    and deleted_at is null
    and search_vector @@ plainto_tsquery('english', p_query)
  order by ts_rank(search_vector, plainto_tsquery('english', p_query)) desc;
$function$
;

CREATE OR REPLACE FUNCTION public.search_tasks_multi(p_project_ids uuid[], p_query text)
 RETURNS SETOF tasks
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select *
  from tasks
  where project_id = any(p_project_ids)
    and deleted_at is null
    and search_vector @@ plainto_tsquery('english', p_query)
  order by ts_rank(search_vector, plainto_tsquery('english', p_query)) desc;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_default_phases(p_project_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_workspace_id uuid;
  v_deleted_at timestamptz;
  v_visibility text;
  v_caller_role text;
  v_existing_count integer;
  v_is_member boolean;
begin
  select workspace_id, deleted_at, visibility
    into v_workspace_id, v_deleted_at, v_visibility
    from projects where id = p_project_id;

  if v_workspace_id is null or v_deleted_at is not null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  select wm.role into v_caller_role
  from workspace_members wm
  where wm.workspace_id = v_workspace_id
    and wm.user_id = auth.uid()
    and wm.status = 'active';

  if v_caller_role is null or v_caller_role in ('viewer', 'client') then
    raise exception 'Only an active team member may seed default phases.'
      using errcode = '42501';
  end if;

  -- F006m: mirror isProjectVisibleToCaller
  -- (lib/actions/project-visibility.ts:16-31) exactly, not
  -- is_project_visible_to, which the Server Action's own gate never calls.
  -- workspace-visible projects are visible to any active member
  -- (guest included); owners/admins see every project; everyone else
  -- needs an explicit project_members row.
  if v_visibility <> 'workspace' and v_caller_role not in ('owner', 'admin') then
    select exists (
      select 1
      from project_members pm
      where pm.project_id = p_project_id
        and pm.user_id = auth.uid()
    ) into v_is_member;

    if not v_is_member then
      raise exception 'You do not have access to this project.'
        using errcode = '42501';
    end if;
  end if;

  select count(*) into v_existing_count
  from project_phases
  where project_id = p_project_id;

  if v_existing_count > 0 then
    return;
  end if;

  insert into project_phases (project_id, name, client_description, position)
  values
    (p_project_id, 'Kick-off & setup', 'Deciding who approves what, and setting up the tools we will work in.', 1),
    (p_project_id, 'Audit & baseline', 'Measuring the current site so we can prove what changed after launch.', 2),
    (p_project_id, 'Site structure', 'Agreeing every page and every URL before anything is designed.', 3),
    (p_project_id, 'Visual direction', 'Choosing the look — moodboard, style, and one design direction.', 4),
    (p_project_id, 'Page design', 'Designing each page in Figma, for your approval, page by page.', 5),
    (p_project_id, 'Assets & content', 'Preparing images and getting the real text onto the pages.', 6),
    (p_project_id, 'Build', 'Building the approved designs in Webflow.', 7),
    (p_project_id, 'Quality assurance', 'A second developer and the designer check every page.', 8),
    (p_project_id, 'Launch', 'Going live, with tracking and redirects verified.', 9),
    (p_project_id, 'Handover', 'Training, documentation, and moving every account into your name.', 10);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_default_project_statuses(target_project_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  insert into project_statuses (project_id, name, color, category, position, client_description)
  values
    (target_project_id, 'todo', '#64748b', 'not_started', 1000, 'Planned. Work has not started yet.'),
    (target_project_id, 'in_progress', '#3b82f6', 'in_progress', 2000, 'The team is actively working on this.'),
    (target_project_id, 'in_review', '#d97706', 'in_progress', 3000, 'The team is reviewing this before it moves forward.'),
    (target_project_id, 'done', '#16a34a', 'done', 4000, 'Delivered.')
  on conflict (project_id, name) do nothing;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.seed_default_project_statuses_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.seed_default_project_statuses(new.id);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.send_change_request_quote_atomic(p_request_id uuid, p_scope_verdict text, p_severity text DEFAULT NULL::text, p_quoted_hours numeric DEFAULT NULL::numeric, p_quoted_amount numeric DEFAULT NULL::numeric, p_quote_currency text DEFAULT NULL::text, p_quote_note text DEFAULT NULL::text, p_quote_valid_until date DEFAULT NULL::date, p_track text DEFAULT NULL::text, p_track_overridden boolean DEFAULT false, p_track_override_reason text DEFAULT NULL::text, p_portal_url text DEFAULT NULL::text)
 RETURNS TABLE(request_id uuid, scope_verdict text, approval_request_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_workspace_id uuid;
  v_title text;
  v_status text;
  v_caller_role text;
  v_approval_id uuid;
  v_prior_approval_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_scope_verdict not in ('in_scope', 'change_request', 'warranty') then
    raise exception 'send_change_request_quote_atomic: invalid scope_verdict %', p_scope_verdict
      using errcode = '22023';
  end if;

  select cr.project_id, cr.title, cr.status, p.workspace_id, cr.approval_request_id
    into v_project_id, v_title, v_status, v_workspace_id, v_prior_approval_id
    from public.client_requests cr
    join public.projects p on p.id = cr.project_id
   where cr.id = p_request_id
     for update of cr;

  if v_project_id is null then
    raise exception 'request not found';
  end if;

  if v_status = 'accepted' then
    raise exception 'this request has already been accepted';
  end if;

  select wm.role into v_caller_role
    from public.workspace_members wm
   where wm.workspace_id = v_workspace_id
     and wm.user_id = v_user_id
     and wm.status = 'active';

  if v_caller_role is null or v_caller_role = 'viewer' or v_caller_role = 'client' then
    raise exception 'caller does not have permission to review requests'
      using errcode = '42501';
  end if;

  if not public.client_gate(
    v_project_id,
    p_require_client_role => false,
    p_require_project_visible => false
  ) then
    raise exception 'portal is not enabled for this project'
      using errcode = '42501';
  end if;

  if p_scope_verdict = 'change_request' and (p_quoted_amount is null or p_quote_valid_until is null) then
    raise exception 'a change request quote needs an amount and a validity date'
      using errcode = '22023';
  end if;

  -- F016f's own Defect 3a, preserved: a fresh quote makes the PRIOR
  -- approval moot. Withdraw it if it is still awaiting a decision.
  if v_prior_approval_id is not null then
    update public.approval_requests
       set state = 'withdrawn'
     where id = v_prior_approval_id
       and state = 'pending';
  end if;

  perform set_config('app.client_requests_triage_guard_bypass', 'on', true);

  update public.client_requests
     set scope_verdict = p_scope_verdict,
         severity = p_severity,
         quoted_hours = p_quoted_hours,
         quoted_amount = p_quoted_amount,
         quote_currency = p_quote_currency,
         quote_note = p_quote_note,
         quote_valid_until = p_quote_valid_until,
         track = p_track,
         track_overridden = coalesce(p_track_overridden, false),
         track_override_reason = case when coalesce(p_track_overridden, false) then p_track_override_reason else null end,
         client_decision = case when p_scope_verdict = 'change_request' then 'pending' else client_decision end,
         status = case when v_status = 'submitted' then 'in_review' else v_status end,
         reviewed_by = v_user_id,
         reviewed_at = now(),
         approval_request_id = null,
         -- F025b: unsent until the branch below (re)sends it — a fresh
         -- quote, or a verdict change away from 'change_request', is not
         -- a quote the client has seen.
         quote_sent_at = null
   where id = p_request_id;

  if p_scope_verdict = 'change_request' then
    insert into public.approval_requests (
      project_id, subject_type, subject_id, artifact_url, title, description,
      decision_type, requested_by, due_at
    )
    values (
      v_project_id, 'artifact', p_request_id,
      coalesce(p_portal_url, 'about:blank'),
      'Quote: ' || v_title,
      p_quote_note,
      'commercial', v_user_id,
      case when p_quote_valid_until is not null then p_quote_valid_until::timestamptz else null end
    )
    returning id into v_approval_id;

    update public.client_requests
       set approval_request_id = v_approval_id,
           -- F025b: this is the one moment "sent" means — the same
           -- statement that raises the client-facing approval.
           quote_sent_at = now()
     where id = p_request_id;
  end if;

  perform set_config('app.client_requests_triage_guard_bypass', 'off', true);

  return query select p_request_id, p_scope_verdict, v_approval_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_saved_view_default(p_view_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner_id uuid;
  v_project_id uuid;
begin
  select owner_id, project_id into v_owner_id, v_project_id
  from saved_views
  where id = p_view_id
  for update;

  if v_owner_id is null then
    raise exception 'View not found.'
      using errcode = 'P0002';
  end if;

  -- Clear any existing default for this (owner, project) pair FIRST, so
  -- the second statement below never collides with the partial unique
  -- index -- both statements run in the same implicit transaction, so a
  -- crash between them cannot leave two defaults set, only (at worst,
  -- impossible under normal execution) zero, which the app layer treats
  -- identically to "no default chosen yet".
  update saved_views
  set is_default = false
  where owner_id = v_owner_id
    and project_id is not distinct from v_project_id
    and id <> p_view_id
    and is_default;

  update saved_views
  set is_default = true
  where id = p_view_id
    and is_default = false;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_task_assignees_atomic(p_task_id uuid, p_desired_user_ids uuid[], p_assigned_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_mirror_id uuid;
  v_project_id uuid;
  v_workspace_id uuid;
  v_caller_role text;
begin
  if auth.uid() is not null then
    select t.project_id, p.workspace_id
      into v_project_id, v_workspace_id
      from public.tasks t
      join public.projects p on p.id = t.project_id
     where t.id = p_task_id;

    if v_project_id is null then
      raise exception 'set_task_assignees_atomic: task not found'
        using errcode = '42501';
    end if;

    select wm.role into v_caller_role
      from public.workspace_members wm
     where wm.workspace_id = v_workspace_id
       and wm.user_id = auth.uid()
       and wm.status = 'active';

    -- canEditTask: owner/admin/member only — viewer, guest, and client
    -- are all excluded (lib/auth/permissions.ts).
    if v_caller_role is null or v_caller_role not in ('owner', 'admin', 'member') then
      raise exception 'set_task_assignees_atomic: caller does not have permission to change this task''s assignees'
        using errcode = '42501';
    end if;

    if not public.is_project_visible_to(v_project_id) then
      raise exception 'set_task_assignees_atomic: caller does not have access to this task''s project'
        using errcode = '42501';
    end if;

    -- A direct caller must not be able to attribute the assignment to
    -- someone else.
    p_assigned_by := auth.uid();
  end if;

  delete from public.task_assignees
  where task_id = p_task_id
    and user_id <> all(p_desired_user_ids);

  insert into public.task_assignees (task_id, user_id, assigned_by)
  select p_task_id, u, p_assigned_by
  from unnest(p_desired_user_ids) as u
  on conflict (task_id, user_id) do nothing;

  select user_id into v_mirror_id
  from public.task_assignees
  where task_id = p_task_id
  order by created_at, user_id
  limit 1;

  update public.tasks
  set assignee_id = v_mirror_id
  where id = p_task_id;

  return v_mirror_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.shares_non_client_workspace_with(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members caller_membership
    join public.workspace_members target_membership
      on target_membership.workspace_id = caller_membership.workspace_id
    join public.workspaces w
      on w.id = caller_membership.workspace_id
    where caller_membership.user_id = auth.uid()
      and caller_membership.status = 'active'
      and caller_membership.role <> 'client'
      and target_membership.user_id = target_user_id
      and target_membership.status = 'active'
      and w.deleted_at is null
  );
$function$
;

CREATE OR REPLACE FUNCTION public.shares_workspace_with(target_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.workspace_members caller_membership
    join public.workspace_members target_membership
      on target_membership.workspace_id = caller_membership.workspace_id
    join public.workspaces w
      on w.id = caller_membership.workspace_id
    where caller_membership.user_id = auth.uid()
      and caller_membership.status = 'active'
      and target_membership.user_id = target_user_id
      and target_membership.status = 'active'
      and w.deleted_at is null
  );
$function$
;

CREATE OR REPLACE FUNCTION public.start_timer_atomic(p_task_id uuid)
 RETURNS TABLE(id uuid, task_id uuid, user_id uuid, started_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_active active_timers%rowtype;
  v_minutes integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  if not public.is_task_workspace_member(p_task_id) then
    raise exception 'not an active member of this task''s workspace';
  end if;

  select * into v_active
  from active_timers
  where active_timers.user_id = v_user_id
  limit 1;

  if found then
    v_minutes := greatest(
      1,
      round(extract(epoch from (now() - v_active.started_at)) / 60.0)
    );

    delete from active_timers where active_timers.id = v_active.id;

    insert into time_entries (task_id, user_id, minutes, billable, entry_date, note)
    values (v_active.task_id, v_user_id, v_minutes, true, current_date, null);
  end if;

  return query
    insert into active_timers (task_id, user_id)
    values (p_task_id, v_user_id)
    returning
      active_timers.id,
      active_timers.task_id,
      active_timers.user_id,
      active_timers.started_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.stop_timer_atomic()
 RETURNS TABLE(id uuid, task_id uuid, user_id uuid, minutes integer, billable boolean, entry_date date, note text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_active active_timers%rowtype;
  v_minutes integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated';
  end if;

  select * into v_active
  from active_timers
  where active_timers.user_id = v_user_id
  limit 1;

  if not found then
    return;
  end if;

  if not public.is_task_workspace_member(v_active.task_id) then
    raise exception 'not an active member of this task''s workspace';
  end if;

  v_minutes := greatest(
    1,
    round(extract(epoch from (now() - v_active.started_at)) / 60.0)
  );

  delete from active_timers where active_timers.id = v_active.id;

  return query
    insert into time_entries (task_id, user_id, minutes, billable, entry_date, note)
    values (v_active.task_id, v_user_id, v_minutes, true, current_date, null)
    returning
      time_entries.id,
      time_entries.task_id,
      time_entries.user_id,
      time_entries.minutes,
      time_entries.billable,
      time_entries.entry_date,
      time_entries.note,
      time_entries.created_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sweep_overdue_blocking_deliverables()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_row record;
  v_blocked_count integer := 0;
begin
  for v_row in
    select distinct on (t.id)
      t.id as task_id,
      cd.id as deliverable_id,
      cd.title as deliverable_title,
      t.status as previous_status,
      ps_blocked.id as blocked_status_id,
      ps_blocked.name as blocked_status_name
    from client_deliverables cd
    join tasks t on t.id = cd.task_id and t.project_id = cd.project_id
    join projects p on p.id = cd.project_id
    join lateral (
      select ps.id, ps.name
      from project_statuses ps
      where ps.project_id = cd.project_id
        and ps.client_bucket = 'blocked'
      order by ps.position asc
      limit 1
    ) ps_blocked on true
    where cd.blocking
      and cd.state not in ('accepted', 'waived')
      and cd.due_at is not null
      and cd.due_at < (now() at time zone 'utc')::date
      and cd.swept_at is null
      and t.deleted_at is null
      and p.deleted_at is null
      and t.status_id is distinct from ps_blocked.id
    order by t.id, cd.due_at asc, cd.position asc
  loop
    update tasks
       set status_id = v_row.blocked_status_id,
           status = v_row.blocked_status_name
     where id = v_row.task_id;

    -- Per-pair, not per-task: only the deliverable this iteration chose
    -- as the cause is stamped. A second overdue deliverable on the same
    -- task that this run did NOT cite (because the task was already
    -- moving into Blocked for the first one) stays unstamped, and can
    -- independently cause a future sweep after this one is accepted and
    -- a human unblocks the task.
    update client_deliverables
       set swept_at = now()
     where id = v_row.deliverable_id;

    perform public.write_task_activity_entry(
      p_task_id => v_row.task_id,
      p_kind => 'field_changed',
      p_field => 'status',
      p_old_value => to_jsonb(v_row.previous_status),
      p_new_value => jsonb_build_object(
        'status', v_row.blocked_status_name,
        'reason', 'client_deliverable_overdue',
        'deliverable_id', v_row.deliverable_id,
        'deliverable_title', v_row.deliverable_title
      ),
      p_system => true
    );

    v_blocked_count := v_blocked_count + 1;
  end loop;

  return v_blocked_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sweep_project_budget_thresholds()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_budget record;
  v_lead record;
  v_spent_minutes integer;
  v_pct numeric;
  v_kind text;
  v_notified_count integer := 0;
  v_notification public.notifications;
  v_lead_found boolean;
begin
  for v_budget in
    select pb.id as budget_id, pb.project_id, pb.period_start, pb.period_end,
           pb.sold_minutes, p.workspace_id
    from project_budgets pb
    join projects p on p.id = pb.project_id
    where p.deleted_at is null
      and pb.period_start <= (now() at time zone 'utc')::date
      and pb.period_end >= (now() at time zone 'utc')::date - 1
  loop
    select coalesce(sum(te.minutes), 0)::integer
      into v_spent_minutes
      from time_entries te
      join tasks t on t.id = te.task_id
      where t.project_id = v_budget.project_id
        and t.deleted_at is null
        and te.billable
        and te.entry_date >= v_budget.period_start
        and te.entry_date <= v_budget.period_end;

    if v_budget.sold_minutes <= 0 then
      continue;
    end if;

    v_pct := (v_spent_minutes::numeric / v_budget.sold_minutes::numeric) * 100;

    if v_pct >= 100 then
      v_kind := 'budget_threshold_100';
    elsif v_pct >= 80 then
      v_kind := 'budget_threshold_80';
    else
      continue;
    end if;

    v_lead_found := false;

    for v_lead in
      select pm.user_id
      from project_members pm
      join workspace_members wm
        on wm.workspace_id = v_budget.workspace_id
       and wm.user_id = pm.user_id
       and wm.status = 'active'
      where pm.project_id = v_budget.project_id
        and pm.project_role = 'lead'
    loop
      v_lead_found := true;

      if exists (
        select 1
        from notifications n
        where n.project_id = v_budget.project_id
          and n.kind = v_kind
          and n.payload ->> 'period_start' = v_budget.period_start::text
          and n.user_id = v_lead.user_id
      ) then
        continue;
      end if;

      begin
        select * into v_notification from public.create_notification(
          p_user_id => v_lead.user_id,
          p_workspace_id => v_budget.workspace_id,
          p_kind => v_kind,
          p_actor_id => null,
          p_task_id => null,
          p_comment_id => null,
          p_payload => jsonb_build_object(
            'project_id', v_budget.project_id,
            'period_start', v_budget.period_start,
            'period_end', v_budget.period_end,
            'sold_minutes', v_budget.sold_minutes,
            'spent_minutes', v_spent_minutes,
            'percent', round(v_pct)
          ),
          p_system => true
        );

        -- F021c: moved inside the exception block -- this UPDATE, not
        -- create_notification's own INSERT, is where
        -- notifications_budget_threshold_once_idx actually raises (see
        -- this migration's header), so it must be covered by the same
        -- per-row guard or one duplicate collision here still aborts the
        -- whole run.
        update notifications set project_id = v_budget.project_id where id = v_notification.id;

        v_notified_count := v_notified_count + 1;
      exception when others then
        raise warning 'sweep_project_budget_thresholds: notify failed for project %, user %: %',
          v_budget.project_id, v_lead.user_id, sqlerrm;
        continue;
      end;
    end loop;

    if not v_lead_found then
      -- F021c: a threshold-crossing project with nobody to notify is
      -- recorded, not silently skipped -- see this migration's header.
      raise warning 'sweep_project_budget_thresholds: no active project lead to notify for project %, kind %, period %',
        v_budget.project_id, v_kind, v_budget.period_start;
    end if;
  end loop;

  return v_notified_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_task_status_and_status_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status_changed boolean;
  v_status_id_changed boolean;
begin
  v_status_changed := tg_op = 'INSERT' or new.status is distinct from old.status;
  v_status_id_changed := tg_op = 'INSERT' or new.status_id is distinct from old.status_id;

  if v_status_changed and new.status is not null then
    -- `status` text was written (the current, unmigrated write path):
    -- derive status_id from the (project_id, name) pair, matching this
    -- feature's seed data, so status_id never falls behind status.
    select ps.id into new.status_id
    from project_statuses ps
    where ps.project_id = new.project_id
      and ps.name = new.status;
  elsif v_status_id_changed and new.status_id is not null then
    -- Only status_id was written (a future/early caller of the new
    -- column): derive status text from status_id's name so every
    -- existing status-reading path keeps working unchanged.
    select ps.name into new.status
    from project_statuses ps
    where ps.id = new.status_id;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_tasks_status_on_column_rename()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.name is distinct from old.name then
    update tasks
    set status = new.name
    where status_id = new.id
       or (status_id is null and project_id = new.project_id and status = old.name);
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.task_types_lock_system_flags()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if OLD.system_key is not null then
    if NEW.is_billable is distinct from OLD.is_billable then
      raise exception 'task_types: is_billable is fixed on a system task type'
        using errcode = '42501';
    end if;
    if OLD.system_key <> 'page' and NEW.system_key is distinct from OLD.system_key then
      raise exception 'task_types: system_key is fixed on this system task type'
        using errcode = '42501';
    end if;
  end if;
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tasks_default_task_type()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_workspace_id uuid;
begin
  if NEW.task_type_id is not null then
    return NEW;
  end if;

  select p.workspace_id into v_workspace_id
    from public.projects p
   where p.id = NEW.project_id;

  if v_workspace_id is null then
    return NEW;
  end if;

  NEW.task_type_id := public.ensure_task_type(
    v_workspace_id, 'delivery', 'Delivery', '#6b7280', true, false
  );
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tasks_update_search_vector()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_project_key text;
  v_task_key text;
  v_description_changed boolean := false;
  v_description_json_changed boolean := false;
begin
  select key into v_project_key from projects where id = new.project_id;

  if v_project_key is not null and new.number is not null and new.number > 0 then
    v_task_key := v_project_key || '-' || new.number::text;
  else
    v_task_key := '';
  end if;

  if tg_op = 'UPDATE' then
    v_description_changed := new.description is distinct from old.description;
    v_description_json_changed :=
      new.description_json is distinct from old.description_json;

    if v_description_changed then
      -- Branch 1 (F170): the legacy plain-text column was written this
      -- call -- derive the rich doc + FTS projection FROM it, exactly as
      -- before.
      new.description_json := public.tiptap_doc_from_text(new.description);
      new.description_text := coalesce(new.description, '');
    elsif v_description_json_changed then
      -- Branch 2 (F173/F205): a direct description_json write, with
      -- description untouched -- keep it as the source of truth, derive
      -- description_text FROM it.
      new.description_text := public.tiptap_text_from_doc(new.description_json);
    end if;
    -- Branch 3 (F205 fix): neither changed -- new.description_json and
    -- new.description_text already equal the old row's values (untouched
    -- columns carry their existing value into `new` on a partial UPDATE),
    -- so there is deliberately nothing to do here.
  elsif tg_op = 'INSERT' then
    if new.description_json is not null then
      new.description_text := public.tiptap_text_from_doc(new.description_json);
    else
      new.description_json := public.tiptap_doc_from_text(new.description);
      new.description_text := coalesce(new.description, '');
    end if;
  end if;

  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(new.description_text, '')), 'B')
    || setweight(to_tsvector('simple', v_task_key), 'A');

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.tiptap_doc_from_text(p_text text)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    when p_text is null or p_text = '' then
      jsonb_build_object('type', 'doc', 'content', jsonb_build_array())
    else
      jsonb_build_object(
        'type', 'doc',
        'content', jsonb_build_array(
          jsonb_build_object(
            'type', 'paragraph',
            'content', jsonb_build_array(
              jsonb_build_object('type', 'text', 'text', p_text)
            )
          )
        )
      )
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.tiptap_text_from_doc(p_doc jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- Recursively collects every node's `text` leaf value via the SQL/JSON
  -- path `$.**.text` (recursive descent, PostgreSQL 12+) and joins them
  -- with a space. Used only to build the FTS projection
  -- (tasks.description_text) -- never rendered to users -- so approximate
  -- word-boundary joining is an acceptable, documented simplification.
  select coalesce(
    string_agg(value #>> '{}', ' '),
    ''
  )
  from jsonb_path_query(coalesce(p_doc, '{}'::jsonb), '$.**.text') as t(value)
  where jsonb_typeof(value) = 'string';
$function$
;

CREATE OR REPLACE FUNCTION public.transfer_workspace_ownership(p_workspace_id uuid, p_new_owner_user_id uuid)
 RETURNS TABLE(transferred boolean, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_owner_membership_id uuid;
  v_owner_role text;
  v_owner_status text;
  v_target_membership_id uuid;
  v_target_role text;
  v_target_status text;
  v_active_owner_count int;
begin
  -- Lock the current owner's row first (deterministic lock ordering by
  -- role='owner' avoids a lock-order deadlock with a concurrent transfer
  -- attempt in the other direction on the same workspace).
  select id, role, status
    into v_owner_membership_id, v_owner_role, v_owner_status
    from workspace_members
   where workspace_id = p_workspace_id
     and role = 'owner'
     and status = 'active'
   order by created_at asc
   limit 1
     for update;

  if v_owner_membership_id is null then
    return query select false, 'no_active_owner';
    return;
  end if;

  -- Lock the target's row.
  select id, role, status
    into v_target_membership_id, v_target_role, v_target_status
    from workspace_members
   where workspace_id = p_workspace_id
     and user_id = p_new_owner_user_id
   order by created_at asc
   limit 1
     for update;

  if v_target_membership_id is null then
    return query select false, 'target_not_member';
    return;
  end if;

  -- AS-234: the target must be an active (non-removed, non-pending) member
  -- of this exact workspace.
  if v_target_status <> 'active' then
    return query select false, 'target_not_active';
    return;
  end if;

  -- A no-op transfer to the current owner themselves is rejected rather
  -- than silently succeeding — there is nothing to transfer.
  if v_target_membership_id = v_owner_membership_id then
    return query select false, 'target_is_current_owner';
    return;
  end if;

  -- Both writes happen together, inside the same transaction as the locks
  -- and validation above — if either statement fails (e.g. a check
  -- constraint violation), Postgres rolls back the whole function body and
  -- neither row changes.
  update workspace_members
     set role = 'owner'
   where id = v_target_membership_id
     and workspace_id = p_workspace_id;

  update workspace_members
     set role = 'admin'
   where id = v_owner_membership_id
     and workspace_id = p_workspace_id;

  -- Defensive invariant check: exactly one active owner must exist for
  -- this workspace after the transfer. Under normal operation this can
  -- never fail (the two updates above always swap one owner for another),
  -- but if the workspace's data was already in an anomalous state (e.g. a
  -- pre-existing duplicate owner row from a bug elsewhere), completing the
  -- transfer would double the anomaly rather than fix it. Raising here
  -- aborts the whole function body — because this runs inside a single
  -- implicit transaction with no exception handler, Postgres rolls back
  -- BOTH updates above, so the original owner's row is left completely
  -- untouched, not partially updated (AS-233's atomicity requirement).
  select count(*)
    into v_active_owner_count
    from workspace_members
   where workspace_id = p_workspace_id
     and role = 'owner'
     and status = 'active';

  if v_active_owner_count <> 1 then
    raise exception 'transfer_workspace_ownership: invariant violated, expected exactly 1 active owner for workspace %, found %', p_workspace_id, v_active_owner_count;
  end if;

  return query select true, null::text;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.write_audit_log_entry(p_workspace_id uuid, p_action text, p_target_type text, p_target_id uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS audit_log
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.audit_log;
begin
  if auth.uid() is null then
    raise exception 'audit_log: no authenticated actor';
  end if;

  -- The caller must be an active member of the workspace they're logging
  -- an entry for (defense in depth — Server Actions should already be
  -- re-checking membership/role before calling this, but the function
  -- does not blindly trust it either).
  if not exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  ) then
    raise exception 'audit_log: caller is not an active member of this workspace';
  end if;

  insert into public.audit_log (workspace_id, actor_id, action, target_type, target_id, metadata)
  values (p_workspace_id, auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb))
  returning * into v_row;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.write_task_activity_entry(p_task_id uuid, p_kind text, p_field text DEFAULT NULL::text, p_old_value jsonb DEFAULT NULL::jsonb, p_new_value jsonb DEFAULT NULL::jsonb, p_system boolean DEFAULT false)
 RETURNS task_activity
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.task_activity;
  v_actor uuid;
begin
  -- A system-generated entry is only exempt from the actor/visibility
  -- checks when the caller genuinely has no user session at all (a real
  -- service-role/cron/backend caller, e.g. the recurrence job). A caller
  -- claiming p_system => true while holding a real auth.uid() (any
  -- `authenticated`-role client session) is NOT exempt -- it falls
  -- through to the same checks as a normal, human-attributed write, so
  -- passing p_system => true can no longer be used to forge a
  -- system-attributed entry or to bypass task visibility.
  if p_system and auth.uid() is null then
    v_actor := null;
  else
    if auth.uid() is null then
      raise exception 'task_activity: no authenticated actor';
    end if;
    if not public.is_task_visible_to(p_task_id) then
      raise exception 'task_activity: caller cannot see this task';
    end if;
    v_actor := auth.uid();
  end if;

  if not exists (select 1 from public.tasks t where t.id = p_task_id) then
    raise exception 'task_activity: task % does not exist', p_task_id;
  end if;

  insert into public.task_activity (task_id, actor_id, kind, field, old_value, new_value)
  values (p_task_id, v_actor, p_kind, p_field, p_old_value, p_new_value)
  returning * into v_row;

  return v_row;
end;
$function$
;


-- ============================ constraints ==============================

alter table public._realtime_capability_probe add constraint _realtime_capability_probe_pkey PRIMARY KEY (id);
alter table public.active_timers add constraint active_timers_pkey PRIMARY KEY (id);
alter table public.ai_messages add constraint ai_messages_pkey PRIMARY KEY (id);
alter table public.ai_threads add constraint ai_threads_pkey PRIMARY KEY (id);
alter table public.approval_requests add constraint approval_requests_pkey PRIMARY KEY (id);
alter table public.attachments add constraint attachments_pkey PRIMARY KEY (id);
alter table public.audit_log add constraint audit_log_pkey PRIMARY KEY (id);
alter table public.board_swimlane_prefs add constraint board_swimlane_prefs_pkey PRIMARY KEY (user_id, project_id);
alter table public.calendar_blocks add constraint calendar_blocks_pkey PRIMARY KEY (id);
alter table public.channel_members add constraint channel_members_pkey PRIMARY KEY (channel_id, user_id);
alter table public.channels add constraint channels_pkey PRIMARY KEY (id);
alter table public.checklist_items add constraint checklist_items_pkey PRIMARY KEY (id);
alter table public.client_deliverables add constraint client_deliverables_pkey PRIMARY KEY (id);
alter table public.client_requests add constraint client_requests_pkey PRIMARY KEY (id);
alter table public.comment_reactions add constraint comment_reactions_pkey PRIMARY KEY (comment_id, user_id, emoji);
alter table public.comments add constraint comments_pkey PRIMARY KEY (id);
alter table public.doc_folders add constraint doc_folders_pkey PRIMARY KEY (id);
alter table public.doc_links add constraint doc_links_pkey PRIMARY KEY (id);
alter table public.docs add constraint docs_pkey PRIMARY KEY (id);
alter table public.f016i_gated_function_oids add constraint f016i_gated_function_oids_pkey PRIMARY KEY (oid);
alter table public.message_attachments add constraint message_attachments_pkey PRIMARY KEY (id);
alter table public.message_reactions add constraint message_reactions_pkey PRIMARY KEY (message_id, user_id, emoji);
alter table public.messages add constraint messages_pkey PRIMARY KEY (id);
alter table public.metric_snapshots add constraint metric_snapshots_pkey PRIMARY KEY (id);
alter table public.notification_preferences add constraint notification_preferences_pkey PRIMARY KEY (user_id);
alter table public.notifications add constraint notifications_pkey PRIMARY KEY (id);
alter table public.page_links add constraint page_links_pkey PRIMARY KEY (id);
alter table public.personal_todos add constraint personal_todos_pkey PRIMARY KEY (id);
alter table public.profiles add constraint profiles_pkey PRIMARY KEY (id);
alter table public.project_accounts add constraint project_accounts_pkey PRIMARY KEY (id);
alter table public.project_assumptions add constraint project_assumptions_pkey PRIMARY KEY (id);
alter table public.project_budgets add constraint project_budgets_pkey PRIMARY KEY (id);
alter table public.project_custom_fields add constraint project_custom_fields_pkey PRIMARY KEY (id);
alter table public.project_decision_owners add constraint project_decision_owners_pkey PRIMARY KEY (id);
alter table public.project_decision_types add constraint project_decision_types_pkey PRIMARY KEY (id);
alter table public.project_decisions add constraint project_decisions_pkey PRIMARY KEY (id);
alter table public.project_favorites add constraint project_favorites_pkey PRIMARY KEY (user_id, project_id);
alter table public.project_improvements add constraint project_improvements_pkey PRIMARY KEY (id);
alter table public.project_links add constraint project_links_pkey PRIMARY KEY (id);
alter table public.project_members add constraint project_members_pkey PRIMARY KEY (id);
alter table public.project_metrics add constraint project_metrics_pkey PRIMARY KEY (id);
alter table public.project_phases add constraint project_phases_pkey PRIMARY KEY (id);
alter table public.project_roles add constraint project_roles_pkey PRIMARY KEY (id);
alter table public.project_scope_documents add constraint project_scope_documents_pkey PRIMARY KEY (id);
alter table public.project_scope_items add constraint project_scope_items_pkey PRIMARY KEY (id);
alter table public.project_statuses add constraint project_statuses_pkey PRIMARY KEY (id);
alter table public.projects add constraint projects_pkey PRIMARY KEY (id);
alter table public.saved_views add constraint saved_views_pkey PRIMARY KEY (id);
alter table public.status_template_items add constraint status_template_items_pkey PRIMARY KEY (id);
alter table public.status_templates add constraint status_templates_pkey PRIMARY KEY (id);
alter table public.task_activity add constraint task_activity_pkey PRIMARY KEY (id);
alter table public.task_assignees add constraint task_assignees_pkey PRIMARY KEY (task_id, user_id);
alter table public.task_custom_field_values add constraint task_custom_field_values_pkey PRIMARY KEY (task_id, field_id);
alter table public.task_dependencies add constraint task_dependencies_pkey PRIMARY KEY (id);
alter table public.task_templates add constraint task_templates_pkey PRIMARY KEY (id);
alter table public.task_types add constraint task_types_pkey PRIMARY KEY (id);
alter table public.task_watchers add constraint task_watchers_pkey PRIMARY KEY (task_id, user_id);
alter table public.tasks add constraint tasks_pkey PRIMARY KEY (id);
alter table public.time_entries add constraint time_entries_pkey PRIMARY KEY (id);
alter table public.time_off_entries add constraint time_off_entries_pkey PRIMARY KEY (id);
alter table public.view_tasks add constraint view_tasks_pkey PRIMARY KEY (id);
alter table public.workspace_members add constraint workspace_members_pkey PRIMARY KEY (id);
alter table public.workspace_slug_history add constraint workspace_slug_history_pkey PRIMARY KEY (id);
alter table public.workspaces add constraint workspaces_pkey PRIMARY KEY (id);
alter table public.active_timers add constraint active_timers_user_id_key UNIQUE (user_id);
alter table public.project_decision_owners add constraint project_decision_owners_project_decision_unique UNIQUE (project_id, decision_type);
alter table public.project_decision_types add constraint project_decision_types_project_name_unique UNIQUE (project_id, name);
alter table public.project_members add constraint project_members_unique_project_user UNIQUE (project_id, user_id);
alter table public.project_phases add constraint project_phases_id_project_id_key UNIQUE (id, project_id);
alter table public.project_roles add constraint project_roles_project_user_role_unique UNIQUE (project_id, user_id, role);
alter table public.projects add constraint projects_key_unique_per_workspace UNIQUE (workspace_id, key);
alter table public.task_dependencies add constraint task_dependencies_unique_pair UNIQUE (blocking_task_id, blocked_task_id);
alter table public.tasks add constraint tasks_id_project_id_key UNIQUE (id, project_id);
alter table public.tasks add constraint tasks_recurrence_occurrence_idempotency UNIQUE (recurrence_parent_id, due_date);
alter table public.view_tasks add constraint view_tasks_view_task_unique UNIQUE (view_id, task_id);
alter table public.workspace_slug_history add constraint workspace_slug_history_old_slug_key UNIQUE (old_slug);
alter table public.workspaces add constraint workspaces_slug_key UNIQUE (slug);
alter table public.project_budgets add constraint project_budgets_no_overlap EXCLUDE USING gist (project_id WITH =, daterange(period_start, period_end, '[]'::text) WITH &&);
alter table public.ai_messages add constraint ai_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));
alter table public.approval_requests add constraint approval_requests_decision_type_not_empty CHECK ((btrim(decision_type) <> ''::text));
alter table public.approval_requests add constraint approval_requests_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'approved'::text, 'changes_requested'::text, 'withdrawn'::text])));
alter table public.approval_requests add constraint approval_requests_subject_shape_check CHECK ((((subject_type <> 'artifact'::text) AND (subject_id IS NOT NULL)) OR ((subject_type = 'artifact'::text) AND (artifact_url IS NOT NULL))));
alter table public.approval_requests add constraint approval_requests_subject_type_check CHECK ((subject_type = ANY (ARRAY['task'::text, 'doc'::text, 'phase'::text, 'artifact'::text])));
alter table public.approval_requests add constraint approval_requests_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.attachments add constraint attachments_file_name_not_empty CHECK ((btrim(file_name) <> ''::text));
alter table public.attachments add constraint attachments_file_url_not_empty CHECK ((btrim(file_url) <> ''::text));
alter table public.board_swimlane_prefs add constraint board_swimlane_prefs_group_by_check CHECK ((group_by = ANY (ARRAY['none'::text, 'assignee'::text, 'priority'::text, 'tag'::text])));
alter table public.calendar_blocks add constraint calendar_blocks_block_type_check CHECK ((block_type = ANY (ARRAY['general'::text, 'client_presentation'::text])));
alter table public.calendar_blocks add constraint calendar_blocks_time_order CHECK ((ends_at > starts_at));
alter table public.calendar_blocks add constraint calendar_blocks_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.channels add constraint channels_channel_kind_requires_name CHECK (((kind <> 'channel'::text) OR ((name IS NOT NULL) AND (btrim(name) <> ''::text))));
alter table public.channels add constraint channels_dm_pair_requires_users CHECK (((kind <> 'dm'::text) OR ((dm_user_low IS NOT NULL) AND (dm_user_high IS NOT NULL) AND (dm_user_low <> dm_user_high))));
alter table public.channels add constraint channels_kind_check CHECK ((kind = ANY (ARRAY['channel'::text, 'dm'::text])));
alter table public.checklist_items add constraint checklist_items_content_not_empty CHECK ((btrim(content) <> ''::text));
alter table public.client_deliverables add constraint client_deliverables_kind_check CHECK ((kind = ANY (ARRAY['copy'::text, 'image'::text, 'access'::text, 'decision'::text, 'data'::text, 'other'::text])));
alter table public.client_deliverables add constraint client_deliverables_owner_name_not_empty CHECK ((btrim(owner_name) <> ''::text));
alter table public.client_deliverables add constraint client_deliverables_state_check CHECK ((state = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'delivered'::text, 'accepted'::text, 'waived'::text])));
alter table public.client_deliverables add constraint client_deliverables_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.client_requests add constraint client_requests_client_decision_check CHECK ((client_decision = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.client_requests add constraint client_requests_converted_only_when_accepted CHECK (((converted_task_id IS NULL) OR (status = 'accepted'::text)));
alter table public.client_requests add constraint client_requests_decline_reason_matches_status CHECK ((((status = 'declined'::text) AND (btrim(COALESCE(decline_reason, ''::text)) <> ''::text)) OR ((status <> 'declined'::text) AND (decline_reason IS NULL))));
alter table public.client_requests add constraint client_requests_kind_check CHECK ((kind = ANY (ARRAY['bug'::text, 'change'::text, 'new_work'::text, 'question'::text])));
alter table public.client_requests add constraint client_requests_quoted_amount_check CHECK ((quoted_amount >= (0)::numeric));
alter table public.client_requests add constraint client_requests_quoted_hours_check CHECK ((quoted_hours > (0)::numeric));
alter table public.client_requests add constraint client_requests_scope_verdict_check CHECK ((scope_verdict = ANY (ARRAY['in_scope'::text, 'change_request'::text, 'warranty'::text])));
alter table public.client_requests add constraint client_requests_severity_check CHECK ((severity = ANY (ARRAY['blocker'::text, 'major'::text, 'minor'::text])));
alter table public.client_requests add constraint client_requests_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'in_review'::text, 'accepted'::text, 'declined'::text])));
alter table public.client_requests add constraint client_requests_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.client_requests add constraint client_requests_track_check CHECK ((track = ANY (ARRAY['design_change'::text, 'dev_change'::text, 'content_seo'::text])));
alter table public.comment_reactions add constraint comment_reactions_emoji_allowlist CHECK ((emoji = ANY (ARRAY['👍'::text, '❤️'::text, '😄'::text, '🎉'::text, '👀'::text, '🚀'::text])));
alter table public.comments add constraint comments_text_not_empty CHECK ((btrim(text) <> ''::text));
alter table public.doc_folders add constraint doc_folders_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.doc_folders add constraint doc_folders_no_self_ref CHECK (((parent_id IS NULL) OR (parent_id <> id)));
alter table public.doc_links add constraint doc_links_description_no_secret_shape CHECK ((NOT looks_like_credential(description)));
alter table public.doc_links add constraint doc_links_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.doc_links add constraint doc_links_url_no_secret_shape CHECK ((NOT looks_like_credential(url)));
alter table public.doc_links add constraint doc_links_url_not_empty CHECK ((btrim(url) <> ''::text));
alter table public.docs add constraint docs_doc_kind_check CHECK ((doc_kind = ANY (ARRAY['note'::text, 'training'::text, 'process'::text, 'handover'::text, 'onboarding'::text, 'feedback'::text, 'portal_guide'::text])));
alter table public.docs add constraint docs_relevant_from_check CHECK (((relevant_from IS NULL) OR (relevant_from = ANY (ARRAY['kickoff'::text, 'ongoing'::text, 'launch'::text]))));
alter table public.docs add constraint docs_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.message_attachments add constraint message_attachments_file_name_not_empty CHECK ((btrim(file_name) <> ''::text));
alter table public.message_attachments add constraint message_attachments_storage_path_not_empty CHECK ((btrim(storage_path) <> ''::text));
alter table public.message_reactions add constraint message_reactions_emoji_allowlist CHECK ((emoji = ANY (ARRAY['👍'::text, '❤️'::text, '😄'::text, '🎉'::text, '👀'::text, '🚀'::text])));
alter table public.notification_preferences add constraint notification_preferences_sound_volume_range CHECK (((sound_volume >= 0) AND (sound_volume <= 100)));
alter table public.notifications add constraint notifications_kind_check CHECK ((kind = ANY (ARRAY['mention'::text, 'comment_reply'::text, 'task_assigned'::text, 'task_due_soon'::text, 'watcher_update'::text, 'approval_decided'::text, 'assumption_flagged'::text, 'budget_threshold_80'::text, 'budget_threshold_100'::text, 'portal_task_decided'::text, 'client_request_submitted'::text, 'client_deliverable_submitted'::text, 'approval_owner_nudge'::text, 'chat_dm'::text, 'chat_thread_reply'::text])));
alter table public.page_links add constraint page_links_kind_check CHECK (is_valid_link_kind(kind));
alter table public.page_links add constraint page_links_label_not_empty CHECK ((btrim(label) <> ''::text));
alter table public.page_links add constraint page_links_url_no_secret_shape CHECK ((NOT looks_like_credential(url)));
alter table public.page_links add constraint page_links_url_not_empty CHECK ((btrim(url) <> ''::text));
alter table public.personal_todos add constraint personal_todos_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.profiles add constraint profiles_timezone_valid CHECK (is_valid_timezone(timezone));
alter table public.project_accounts add constraint project_accounts_note_no_secret_shape CHECK ((NOT looks_like_credential(note)));
alter table public.project_accounts add constraint project_accounts_owner_check CHECK ((owner = ANY (ARRAY['client'::text, 'agency'::text])));
alter table public.project_accounts add constraint project_accounts_service_no_secret_shape CHECK ((NOT looks_like_credential(service)));
alter table public.project_accounts add constraint project_accounts_service_not_empty CHECK ((btrim(service) <> ''::text));
alter table public.project_accounts add constraint project_accounts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'provisioned'::text, 'transferred'::text])));
alter table public.project_assumptions add constraint project_assumptions_state_check CHECK ((state = ANY (ARRAY['assumed'::text, 'confirmed'::text, 'invalidated'::text])));
alter table public.project_assumptions add constraint project_assumptions_text_not_empty CHECK ((btrim(text) <> ''::text));
alter table public.project_budgets add constraint project_budgets_period_valid CHECK ((period_end >= period_start));
alter table public.project_budgets add constraint project_budgets_rollover_check CHECK ((rollover = ANY (ARRAY['none'::text, 'next_period'::text, 'unlimited'::text])));
alter table public.project_budgets add constraint project_budgets_sold_minutes_check CHECK ((sold_minutes > 0));
alter table public.project_custom_fields add constraint project_custom_fields_field_type_check CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'url'::text, 'checkbox'::text])));
alter table public.project_custom_fields add constraint project_custom_fields_name_length CHECK ((char_length(name) <= 100));
alter table public.project_custom_fields add constraint project_custom_fields_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.project_decision_owners add constraint project_decision_owners_decision_type_not_empty CHECK ((btrim(decision_type) <> ''::text));
alter table public.project_decision_types add constraint project_decision_types_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.project_decisions add constraint project_decisions_decision_type_check CHECK ((decision_type = ANY (ARRAY['content'::text, 'brand'::text, 'technical'::text, 'commercial'::text])));
alter table public.project_decisions add constraint project_decisions_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.project_improvements add constraint project_improvements_area_not_empty CHECK ((btrim(area) <> ''::text));
alter table public.project_improvements add constraint project_improvements_explanation_not_empty CHECK ((btrim(explanation) <> ''::text));
alter table public.project_links add constraint project_links_kind_check CHECK (is_valid_link_kind(kind));
alter table public.project_links add constraint project_links_label_not_empty CHECK ((btrim(label) <> ''::text));
alter table public.project_links add constraint project_links_url_no_secret_shape CHECK ((NOT looks_like_credential(url)));
alter table public.project_links add constraint project_links_url_not_empty CHECK ((btrim(url) <> ''::text));
alter table public.project_members add constraint project_members_project_role_check CHECK ((project_role = ANY (ARRAY['lead'::text, 'member'::text])));
alter table public.project_metrics add constraint project_metrics_direction_check CHECK ((direction = ANY (ARRAY['higher'::text, 'lower'::text])));
alter table public.project_metrics add constraint project_metrics_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.project_metrics add constraint project_metrics_source_check CHECK ((source = ANY (ARRAY['gsc'::text, 'ga4'::text, 'lighthouse'::text, 'crux'::text, 'manual'::text, 'other'::text])));
alter table public.project_phases add constraint project_phases_blocked_reason_length_check CHECK (((blocked_reason IS NULL) OR (char_length(blocked_reason) <= 500)));
alter table public.project_phases add constraint project_phases_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.project_phases add constraint project_phases_state_check CHECK ((state = ANY (ARRAY['not_started'::text, 'active'::text, 'blocked'::text, 'done'::text])));
alter table public.project_roles add constraint project_roles_role_check CHECK ((role = ANY (ARRAY['pm'::text, 'team_lead'::text, 'design_lead'::text, 'webflow_lead'::text, 'designer'::text, 'developer'::text])));
alter table public.project_scope_documents add constraint project_scope_documents_kind_check CHECK ((kind = ANY (ARRAY['upload'::text, 'link'::text])));
alter table public.project_scope_documents add constraint project_scope_documents_shape_check CHECK ((((kind = 'upload'::text) AND (file_path IS NOT NULL) AND (btrim(file_path) <> ''::text) AND (url IS NULL)) OR ((kind = 'link'::text) AND (url IS NOT NULL) AND (btrim(url) <> ''::text) AND (file_path IS NULL))));
alter table public.project_scope_documents add constraint project_scope_documents_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.project_scope_items add constraint project_scope_items_source_check CHECK ((source = ANY (ARRAY['proposal'::text, 'change_request'::text])));
alter table public.project_scope_items add constraint project_scope_items_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.project_statuses add constraint project_statuses_category_check CHECK ((category = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'done'::text])));
alter table public.project_statuses add constraint project_statuses_client_bucket_check CHECK (((client_bucket IS NULL) OR (client_bucket = ANY (ARRAY['waiting'::text, 'progress'::text, 'blocked'::text, 'done'::text]))));
alter table public.project_statuses add constraint project_statuses_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.projects add constraint projects_end_date_after_start_date CHECK (((end_date IS NULL) OR (start_date IS NULL) OR (end_date >= start_date)));
alter table public.projects add constraint projects_key_format CHECK ((key ~ '^[A-Z][A-Z0-9]{1,5}$'::text));
alter table public.projects add constraint projects_launch_confidence_check CHECK (((launch_confidence IS NULL) OR (launch_confidence = ANY (ARRAY['on_track'::text, 'at_risk'::text, 'slipped'::text]))));
alter table public.projects add constraint projects_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.projects add constraint projects_visibility_check CHECK ((visibility = ANY (ARRAY['workspace'::text, 'private'::text])));
alter table public.saved_views add constraint saved_views_config_is_object CHECK ((jsonb_typeof(config) = 'object'::text));
alter table public.saved_views add constraint saved_views_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.saved_views add constraint saved_views_scope_check CHECK ((scope = ANY (ARRAY['personal'::text, 'shared'::text])));
alter table public.saved_views add constraint saved_views_view_type_check CHECK ((view_type = ANY (ARRAY['board'::text, 'list'::text, 'calendar'::text, 'timeline'::text])));
alter table public.status_template_items add constraint status_template_items_category_check CHECK ((category = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'done'::text])));
alter table public.status_template_items add constraint status_template_items_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.status_templates add constraint status_templates_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.task_activity add constraint task_activity_field_presence_check CHECK ((((kind = 'field_changed'::text) AND (field IS NOT NULL)) OR ((kind <> 'field_changed'::text) AND (field IS NULL))));
alter table public.task_activity add constraint task_activity_kind_check CHECK ((kind = ANY (ARRAY['field_changed'::text, 'comment_added'::text, 'comment_deleted'::text])));
alter table public.task_custom_field_values add constraint task_custom_field_values_value_length CHECK (((value IS NULL) OR (char_length(value) <= 2000)));
alter table public.task_dependencies add constraint task_dependencies_not_self CHECK ((blocking_task_id <> blocked_task_id));
alter table public.task_templates add constraint task_templates_kind_check CHECK ((kind = ANY (ARRAY['task'::text, 'project'::text, 'doc'::text])));
alter table public.task_templates add constraint task_templates_name_check CHECK ((char_length(btrim(name)) > 0));
alter table public.task_types add constraint task_types_name_not_empty CHECK ((btrim(name) <> ''::text));
alter table public.task_types add constraint task_types_system_key_check CHECK (((system_key IS NULL) OR (system_key = ANY (ARRAY['page'::text, 'qa'::text, 'component'::text, 'content'::text, 'seo'::text, 'delivery'::text, 'client_request'::text, 'change_request'::text, 'improvement'::text]))));
alter table public.tasks add constraint tasks_blocked_reason_length_check CHECK (((blocked_reason IS NULL) OR (char_length(blocked_reason) <= 500)));
alter table public.tasks add constraint tasks_estimate_minutes_positive CHECK (((estimate_minutes IS NULL) OR (estimate_minutes > 0)));
alter table public.tasks add constraint tasks_number_positive CHECK ((number > 0));
alter table public.tasks add constraint tasks_parent_not_self CHECK (((parent_task_id IS NULL) OR (parent_task_id <> id)));
alter table public.tasks add constraint tasks_priority_check CHECK (((priority IS NULL) OR (priority = ANY (ARRAY['urgent'::text, 'high'::text, 'medium'::text, 'low'::text, 'backlog'::text]))));
alter table public.tasks add constraint tasks_recurrence_shape CHECK (((recurrence IS NULL) OR ((recurrence ? 'freq'::text) AND ((recurrence ->> 'freq'::text) = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text, 'every_n_days'::text])) AND (recurrence ? 'interval'::text) AND ((recurrence ->> 'interval'::text) ~ '^[0-9]+$'::text) AND (((recurrence ->> 'interval'::text))::integer > 0) AND ((NOT (recurrence ? 'until'::text)) OR ((recurrence -> 'until'::text) = 'null'::jsonb) OR ((jsonb_typeof((recurrence -> 'until'::text)) = 'string'::text) AND (((recurrence ->> 'until'::text))::date IS NOT NULL))))));
alter table public.tasks add constraint tasks_start_date_not_after_due_date CHECK (((start_date IS NULL) OR (due_date IS NULL) OR (start_date <= due_date)));
alter table public.tasks add constraint tasks_status_not_empty CHECK ((btrim(status) <> ''::text));
alter table public.tasks add constraint tasks_title_not_empty CHECK ((btrim(title) <> ''::text));
alter table public.time_entries add constraint time_entries_minutes_positive CHECK ((minutes > 0));
alter table public.time_entries add constraint time_entries_work_category_check CHECK ((work_category = ANY (ARRAY['design'::text, 'development'::text, 'content_seo'::text, 'pm'::text, 'qa'::text])));
alter table public.time_off_entries add constraint time_off_entries_date_order CHECK ((end_date >= start_date));
alter table public.time_off_entries add constraint time_off_entries_note_not_blank CHECK (((note IS NULL) OR (btrim(note) <> ''::text)));
alter table public.workspace_members add constraint workspace_members_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text, 'guest'::text, 'client'::text])));
alter table public.workspace_members add constraint workspace_members_status_check CHECK ((status = ANY (ARRAY['invited'::text, 'active'::text])));
alter table public.workspace_members add constraint workspace_members_status_note_not_blank CHECK (((status_note IS NULL) OR (btrim(status_note) <> ''::text)));
alter table public.active_timers add constraint active_timers_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id);
alter table public.active_timers add constraint active_timers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.ai_messages add constraint ai_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES ai_threads(id) ON DELETE CASCADE;
alter table public.ai_threads add constraint ai_threads_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
alter table public.ai_threads add constraint ai_threads_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES docs(id) ON DELETE SET NULL;
alter table public.ai_threads add constraint ai_threads_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.ai_threads add constraint ai_threads_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.approval_requests add constraint approval_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id);
alter table public.approval_requests add constraint approval_requests_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES project_phases(id) ON DELETE SET NULL;
alter table public.approval_requests add constraint approval_requests_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.approval_requests add constraint approval_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id);
alter table public.approval_requests add constraint approval_requests_resulting_task_id_fkey FOREIGN KEY (resulting_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
alter table public.approval_requests add constraint approval_requests_supersedes_id_fkey FOREIGN KEY (supersedes_id) REFERENCES approval_requests(id);
alter table public.attachments add constraint attachments_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id);
alter table public.attachments add constraint attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);
alter table public.audit_log add constraint audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.audit_log add constraint audit_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.board_swimlane_prefs add constraint board_swimlane_prefs_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.board_swimlane_prefs add constraint board_swimlane_prefs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.calendar_blocks add constraint calendar_blocks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.calendar_blocks add constraint calendar_blocks_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.calendar_blocks add constraint calendar_blocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.calendar_blocks add constraint calendar_blocks_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.channel_members add constraint channel_members_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;
alter table public.channel_members add constraint channel_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.channels add constraint channels_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.channels add constraint channels_dm_user_high_fkey FOREIGN KEY (dm_user_high) REFERENCES auth.users(id);
alter table public.channels add constraint channels_dm_user_low_fkey FOREIGN KEY (dm_user_low) REFERENCES auth.users(id);
alter table public.channels add constraint channels_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.channels add constraint channels_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.checklist_items add constraint checklist_items_checked_by_fkey FOREIGN KEY (checked_by) REFERENCES auth.users(id);
alter table public.checklist_items add constraint checklist_items_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id);
alter table public.client_deliverables add constraint client_deliverables_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES auth.users(id);
alter table public.client_deliverables add constraint client_deliverables_phase_id_fkey FOREIGN KEY (phase_id, project_id) REFERENCES project_phases(id, project_id) ON DELETE SET NULL (phase_id);
alter table public.client_deliverables add constraint client_deliverables_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.client_deliverables add constraint client_deliverables_task_id_fkey FOREIGN KEY (task_id, project_id) REFERENCES tasks(id, project_id) ON DELETE SET NULL (task_id);
alter table public.client_requests add constraint client_requests_approval_request_id_fkey FOREIGN KEY (approval_request_id) REFERENCES approval_requests(id) ON DELETE SET NULL;
alter table public.client_requests add constraint client_requests_converted_task_id_fkey FOREIGN KEY (converted_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
alter table public.client_requests add constraint client_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.client_requests add constraint client_requests_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES auth.users(id);
alter table public.client_requests add constraint client_requests_origin_assumption_id_fkey FOREIGN KEY (origin_assumption_id) REFERENCES project_assumptions(id) ON DELETE SET NULL;
alter table public.client_requests add constraint client_requests_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.client_requests add constraint client_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id);
alter table public.comment_reactions add constraint comment_reactions_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE;
alter table public.comment_reactions add constraint comment_reactions_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.comment_reactions add constraint comment_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.comments add constraint comments_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id);
alter table public.comments add constraint comments_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id);
alter table public.comments add constraint comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.doc_folders add constraint doc_folders_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.doc_folders add constraint doc_folders_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES doc_folders(id) ON DELETE CASCADE;
alter table public.doc_folders add constraint doc_folders_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.doc_folders add constraint doc_folders_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.doc_links add constraint doc_links_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES docs(id) ON DELETE CASCADE;
alter table public.docs add constraint docs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.docs add constraint docs_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES doc_folders(id) ON DELETE SET NULL;
alter table public.docs add constraint docs_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.docs add constraint docs_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id);
alter table public.docs add constraint docs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.message_attachments add constraint message_attachments_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;
alter table public.message_attachments add constraint message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
alter table public.message_attachments add constraint message_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);
alter table public.message_reactions add constraint message_reactions_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;
alter table public.message_reactions add constraint message_reactions_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE;
alter table public.message_reactions add constraint message_reactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_channel_id_fkey FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE SET NULL;
alter table public.messages add constraint messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id);
alter table public.metric_snapshots add constraint metric_snapshots_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.metric_snapshots add constraint metric_snapshots_metric_id_fkey FOREIGN KEY (metric_id) REFERENCES project_metrics(id) ON DELETE CASCADE;
alter table public.notification_preferences add constraint notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.notifications add constraint notifications_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.notifications add constraint notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.page_links add constraint page_links_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.personal_todos add constraint personal_todos_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL;
alter table public.personal_todos add constraint personal_todos_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;
alter table public.personal_todos add constraint personal_todos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.personal_todos add constraint personal_todos_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.profiles add constraint profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.project_accounts add constraint project_accounts_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_assumptions add constraint project_assumptions_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_budgets add constraint project_budgets_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_custom_fields add constraint project_custom_fields_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_decision_owners add constraint project_decision_owners_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_decision_owners add constraint project_decision_owners_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.project_decision_types add constraint project_decision_types_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_decisions add constraint project_decisions_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.project_decisions add constraint project_decisions_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES project_phases(id) ON DELETE SET NULL;
alter table public.project_decisions add constraint project_decisions_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_favorites add constraint project_favorites_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_favorites add constraint project_favorites_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.project_improvements add constraint project_improvements_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_links add constraint project_links_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_members add constraint project_members_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id);
alter table public.project_members add constraint project_members_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id);
alter table public.project_members add constraint project_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.project_metrics add constraint project_metrics_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_phases add constraint project_phases_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_roles add constraint project_roles_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id);
alter table public.project_roles add constraint project_roles_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_roles add constraint project_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.project_scope_documents add constraint project_scope_documents_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_scope_documents add constraint project_scope_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id);
alter table public.project_scope_items add constraint project_scope_items_change_request_id_fkey FOREIGN KEY (change_request_id) REFERENCES client_requests(id) ON DELETE SET NULL;
alter table public.project_scope_items add constraint project_scope_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.project_statuses add constraint project_statuses_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.projects add constraint projects_archived_by_fkey FOREIGN KEY (archived_by) REFERENCES auth.users(id);
alter table public.projects add constraint projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.projects add constraint projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table public.saved_views add constraint saved_views_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.saved_views add constraint saved_views_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
alter table public.saved_views add constraint saved_views_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.status_template_items add constraint status_template_items_template_id_fkey FOREIGN KEY (template_id) REFERENCES status_templates(id) ON DELETE CASCADE;
alter table public.status_templates add constraint status_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.status_templates add constraint status_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.task_activity add constraint task_activity_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.task_activity add constraint task_activity_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_assignees add constraint task_assignees_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES auth.users(id);
alter table public.task_assignees add constraint task_assignees_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_assignees add constraint task_assignees_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.task_custom_field_values add constraint task_custom_field_values_field_id_fkey FOREIGN KEY (field_id) REFERENCES project_custom_fields(id) ON DELETE CASCADE;
alter table public.task_custom_field_values add constraint task_custom_field_values_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_dependencies add constraint task_dependencies_blocked_task_id_fkey FOREIGN KEY (blocked_task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_dependencies add constraint task_dependencies_blocking_task_id_fkey FOREIGN KEY (blocking_task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_dependencies add constraint task_dependencies_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.task_templates add constraint task_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.task_templates add constraint task_templates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.task_types add constraint task_types_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.task_watchers add constraint task_watchers_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.task_watchers add constraint task_watchers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.tasks add constraint tasks_assignee_id_fkey FOREIGN KEY (assignee_id) REFERENCES auth.users(id);
alter table public.tasks add constraint tasks_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id);
alter table public.tasks add constraint tasks_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES auth.users(id);
alter table public.tasks add constraint tasks_deleted_via_task_id_fkey FOREIGN KEY (deleted_via_task_id) REFERENCES tasks(id);
alter table public.tasks add constraint tasks_parent_task_id_fkey FOREIGN KEY (parent_task_id) REFERENCES tasks(id);
alter table public.tasks add constraint tasks_phase_id_fkey FOREIGN KEY (phase_id) REFERENCES project_phases(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id);
alter table public.tasks add constraint tasks_recurrence_parent_id_fkey FOREIGN KEY (recurrence_parent_id) REFERENCES tasks(id) ON DELETE SET NULL;
alter table public.tasks add constraint tasks_status_id_fkey FOREIGN KEY (status_id) REFERENCES project_statuses(id);
alter table public.tasks add constraint tasks_task_type_id_fkey FOREIGN KEY (task_type_id) REFERENCES task_types(id) ON DELETE RESTRICT;
alter table public.time_entries add constraint time_entries_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id);
alter table public.time_entries add constraint time_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.time_off_entries add constraint time_off_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.time_off_entries add constraint time_off_entries_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
alter table public.view_tasks add constraint view_tasks_added_by_fkey FOREIGN KEY (added_by) REFERENCES auth.users(id) ON DELETE SET NULL;
alter table public.view_tasks add constraint view_tasks_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
alter table public.view_tasks add constraint view_tasks_view_id_fkey FOREIGN KEY (view_id) REFERENCES saved_views(id) ON DELETE CASCADE;
alter table public.workspace_members add constraint workspace_members_invited_project_id_fkey FOREIGN KEY (invited_project_id) REFERENCES projects(id);
alter table public.workspace_members add constraint workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.workspace_members add constraint workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id);
alter table public.workspace_slug_history add constraint workspace_slug_history_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

-- =============================== indexes ===============================

CREATE INDEX active_timers_task_id_idx ON public.active_timers USING btree (task_id);
CREATE INDEX ai_messages_thread_id_created_at_idx ON public.ai_messages USING btree (thread_id, created_at);
CREATE INDEX ai_threads_created_by_idx ON public.ai_threads USING btree (created_by);
CREATE INDEX ai_threads_doc_id_idx ON public.ai_threads USING btree (doc_id);
CREATE INDEX ai_threads_project_id_idx ON public.ai_threads USING btree (project_id);
CREATE INDEX ai_threads_workspace_id_created_at_idx ON public.ai_threads USING btree (workspace_id, created_at DESC);
CREATE INDEX approval_requests_project_id_state_idx ON public.approval_requests USING btree (project_id, state);
CREATE INDEX approval_requests_subject_type_subject_id_idx ON public.approval_requests USING btree (subject_type, subject_id);
CREATE INDEX idx_approval_requests_decided_by ON public.approval_requests USING btree (decided_by);
CREATE INDEX idx_approval_requests_phase_id ON public.approval_requests USING btree (phase_id);
CREATE INDEX idx_approval_requests_requested_by ON public.approval_requests USING btree (requested_by);
CREATE INDEX idx_approval_requests_resulting_task_id ON public.approval_requests USING btree (resulting_task_id);
CREATE INDEX idx_approval_requests_supersedes_id ON public.approval_requests USING btree (supersedes_id);
CREATE INDEX attachments_task_id_idx ON public.attachments USING btree (task_id);
CREATE INDEX idx_attachments_uploaded_by ON public.attachments USING btree (uploaded_by);
CREATE INDEX audit_log_actor_id_idx ON public.audit_log USING btree (actor_id);
CREATE INDEX audit_log_workspace_id_created_at_idx ON public.audit_log USING btree (workspace_id, created_at DESC);
CREATE INDEX idx_board_swimlane_prefs_project_id ON public.board_swimlane_prefs USING btree (project_id);
CREATE INDEX calendar_blocks_client_presentation_idx ON public.calendar_blocks USING btree (workspace_id, starts_at) WHERE (block_type = 'client_presentation'::text);
CREATE INDEX calendar_blocks_task_id_idx ON public.calendar_blocks USING btree (task_id) WHERE (task_id IS NOT NULL);
CREATE INDEX calendar_blocks_user_id_idx ON public.calendar_blocks USING btree (user_id);
CREATE INDEX calendar_blocks_workspace_id_starts_at_idx ON public.calendar_blocks USING btree (workspace_id, starts_at);
CREATE INDEX idx_calendar_blocks_project_id ON public.calendar_blocks USING btree (project_id);
CREATE INDEX channel_members_user_id_idx ON public.channel_members USING btree (user_id);
CREATE UNIQUE INDEX channels_dm_unique_pair_idx ON public.channels USING btree (workspace_id, dm_user_low, dm_user_high) WHERE (kind = 'dm'::text);
CREATE UNIQUE INDEX channels_one_channel_per_project_idx ON public.channels USING btree (project_id) WHERE ((kind = 'channel'::text) AND (project_id IS NOT NULL));
CREATE INDEX channels_project_id_idx ON public.channels USING btree (project_id) WHERE (project_id IS NOT NULL);
CREATE INDEX channels_workspace_id_idx ON public.channels USING btree (workspace_id);
CREATE INDEX idx_channels_created_by ON public.channels USING btree (created_by);
CREATE INDEX idx_channels_dm_user_high ON public.channels USING btree (dm_user_high);
CREATE INDEX idx_channels_dm_user_low ON public.channels USING btree (dm_user_low);
CREATE INDEX checklist_items_task_id_position_idx ON public.checklist_items USING btree (task_id, "position");
CREATE INDEX idx_checklist_items_checked_by ON public.checklist_items USING btree (checked_by);
CREATE INDEX client_deliverables_project_id_blocking_due_idx ON public.client_deliverables USING btree (project_id, due_at) WHERE (blocking AND (state <> ALL (ARRAY['accepted'::text, 'waived'::text])));
CREATE INDEX client_deliverables_project_id_position_idx ON public.client_deliverables USING btree (project_id, "position");
CREATE INDEX client_deliverables_task_id_idx ON public.client_deliverables USING btree (task_id);
CREATE INDEX idx_client_deliverables_accepted_by ON public.client_deliverables USING btree (accepted_by);
CREATE INDEX idx_client_deliverables_phase_id_project_id ON public.client_deliverables USING btree (phase_id, project_id);
CREATE INDEX idx_client_deliverables_task_id_project_id ON public.client_deliverables USING btree (task_id, project_id);
CREATE INDEX client_requests_created_by_idx ON public.client_requests USING btree (created_by);
CREATE INDEX client_requests_origin_assumption_id_idx ON public.client_requests USING btree (origin_assumption_id) WHERE (origin_assumption_id IS NOT NULL);
CREATE INDEX client_requests_project_id_idx ON public.client_requests USING btree (project_id);
CREATE INDEX client_requests_scope_verdict_idx ON public.client_requests USING btree (scope_verdict) WHERE (scope_verdict = 'change_request'::text);
CREATE INDEX client_requests_status_created_at_idx ON public.client_requests USING btree (status, created_at DESC);
CREATE INDEX idx_client_requests_approval_request_id ON public.client_requests USING btree (approval_request_id);
CREATE INDEX idx_client_requests_converted_task_id ON public.client_requests USING btree (converted_task_id);
CREATE INDEX idx_client_requests_decided_by ON public.client_requests USING btree (decided_by);
CREATE INDEX idx_client_requests_reviewed_by ON public.client_requests USING btree (reviewed_by);
CREATE INDEX comment_reactions_task_id_idx ON public.comment_reactions USING btree (task_id);
CREATE INDEX comment_reactions_user_id_idx ON public.comment_reactions USING btree (user_id);
CREATE INDEX comments_task_id_idx ON public.comments USING btree (task_id);
CREATE INDEX comments_task_id_internal_idx ON public.comments USING btree (task_id, internal);
CREATE INDEX idx_comments_deleted_by ON public.comments USING btree (deleted_by);
CREATE INDEX idx_comments_user_id ON public.comments USING btree (user_id);
CREATE INDEX doc_folders_workspace_project_parent_idx ON public.doc_folders USING btree (workspace_id, project_id, parent_id);
CREATE INDEX doc_folders_workspace_project_position_idx ON public.doc_folders USING btree (workspace_id, project_id, "position");
CREATE INDEX idx_doc_folders_created_by ON public.doc_folders USING btree (created_by);
CREATE INDEX idx_doc_folders_parent_id ON public.doc_folders USING btree (parent_id);
CREATE INDEX idx_doc_folders_project_id ON public.doc_folders USING btree (project_id);
CREATE INDEX doc_links_doc_id_position_idx ON public.doc_links USING btree (doc_id, "position");
CREATE INDEX docs_workspace_project_folder_idx ON public.docs USING btree (workspace_id, project_id, folder_id);
CREATE INDEX docs_workspace_project_position_idx ON public.docs USING btree (workspace_id, project_id, "position");
CREATE INDEX idx_docs_created_by ON public.docs USING btree (created_by);
CREATE INDEX idx_docs_folder_id ON public.docs USING btree (folder_id);
CREATE INDEX idx_docs_project_id ON public.docs USING btree (project_id);
CREATE INDEX idx_docs_updated_by ON public.docs USING btree (updated_by);
CREATE INDEX message_attachments_channel_id_idx ON public.message_attachments USING btree (channel_id);
CREATE INDEX message_attachments_message_id_idx ON public.message_attachments USING btree (message_id) WHERE (message_id IS NOT NULL);
CREATE INDEX message_attachments_uploaded_by_pending_idx ON public.message_attachments USING btree (uploaded_by, channel_id) WHERE (message_id IS NULL);
CREATE INDEX message_reactions_channel_id_idx ON public.message_reactions USING btree (channel_id);
CREATE INDEX message_reactions_user_id_idx ON public.message_reactions USING btree (user_id);
CREATE INDEX messages_body_text_search_idx ON public.messages USING gin (to_tsvector('english'::regconfig, body_text));
CREATE INDEX messages_channel_created_idx ON public.messages USING btree (channel_id, created_at);
CREATE INDEX messages_parent_message_id_idx ON public.messages USING btree (parent_message_id) WHERE (parent_message_id IS NOT NULL);
CREATE INDEX messages_sender_id_idx ON public.messages USING btree (sender_id);
CREATE INDEX idx_metric_snapshots_created_by ON public.metric_snapshots USING btree (created_by);
CREATE INDEX metric_snapshots_metric_id_measured_at_idx ON public.metric_snapshots USING btree (metric_id, measured_at DESC);
CREATE INDEX idx_notifications_actor_id ON public.notifications USING btree (actor_id);
CREATE INDEX idx_notifications_comment_id ON public.notifications USING btree (comment_id);
CREATE INDEX idx_notifications_task_id ON public.notifications USING btree (task_id);
CREATE INDEX idx_notifications_workspace_id ON public.notifications USING btree (workspace_id);
CREATE UNIQUE INDEX notifications_budget_threshold_once_idx ON public.notifications USING btree (project_id, user_id, kind, ((payload ->> 'period_start'::text))) WHERE ((kind = ANY (ARRAY['budget_threshold_80'::text, 'budget_threshold_100'::text])) AND (project_id IS NOT NULL));
CREATE UNIQUE INDEX notifications_overdue_once_idx ON public.notifications USING btree (user_id, task_id) WHERE (kind = 'task_due_soon'::text);
CREATE INDEX notifications_project_id_idx ON public.notifications USING btree (project_id) WHERE (project_id IS NOT NULL);
CREATE INDEX notifications_user_id_read_at_created_at_idx ON public.notifications USING btree (user_id, read_at, created_at DESC);
CREATE INDEX notifications_user_workspace_created_idx ON public.notifications USING btree (user_id, workspace_id, created_at DESC);
CREATE INDEX page_links_task_id_position_idx ON public.page_links USING btree (task_id, "position");
CREATE INDEX idx_personal_todos_workspace_id ON public.personal_todos USING btree (workspace_id);
CREATE INDEX personal_todos_project_id_idx ON public.personal_todos USING btree (project_id) WHERE (project_id IS NOT NULL);
CREATE INDEX personal_todos_task_id_idx ON public.personal_todos USING btree (task_id) WHERE (task_id IS NOT NULL);
CREATE INDEX personal_todos_user_id_workspace_id_idx ON public.personal_todos USING btree (user_id, workspace_id);
CREATE INDEX personal_todos_user_id_workspace_id_position_idx ON public.personal_todos USING btree (user_id, workspace_id, "position");
CREATE INDEX project_accounts_project_id_position_idx ON public.project_accounts USING btree (project_id, "position");
CREATE INDEX project_assumptions_project_id_idx ON public.project_assumptions USING btree (project_id);
CREATE INDEX project_budgets_project_id_idx ON public.project_budgets USING btree (project_id);
CREATE UNIQUE INDEX project_custom_fields_project_id_name_idx ON public.project_custom_fields USING btree (project_id, name);
CREATE INDEX project_custom_fields_project_id_position_idx ON public.project_custom_fields USING btree (project_id, "position");
CREATE INDEX idx_project_decision_owners_user_id ON public.project_decision_owners USING btree (user_id);
CREATE INDEX project_decision_types_project_id_sort_idx ON public.project_decision_types USING btree (project_id, sort_order);
CREATE INDEX idx_project_decisions_created_by ON public.project_decisions USING btree (created_by);
CREATE INDEX idx_project_decisions_phase_id ON public.project_decisions USING btree (phase_id);
CREATE INDEX project_decisions_project_id_decided_on_idx ON public.project_decisions USING btree (project_id, decided_on DESC);
CREATE INDEX idx_project_favorites_project_id ON public.project_favorites USING btree (project_id);
CREATE INDEX project_favorites_user_id_idx ON public.project_favorites USING btree (user_id);
CREATE INDEX project_improvements_project_id_position_idx ON public.project_improvements USING btree (project_id, "position");
CREATE INDEX project_links_project_id_position_idx ON public.project_links USING btree (project_id, "position");
CREATE INDEX idx_project_members_added_by ON public.project_members USING btree (added_by);
CREATE INDEX project_members_project_id_idx ON public.project_members USING btree (project_id);
CREATE INDEX project_members_user_id_idx ON public.project_members USING btree (user_id);
CREATE INDEX project_metrics_project_id_position_idx ON public.project_metrics USING btree (project_id, "position");
CREATE INDEX project_phases_project_id_position_idx ON public.project_phases USING btree (project_id, "position");
CREATE INDEX idx_project_roles_added_by ON public.project_roles USING btree (added_by);
CREATE INDEX idx_project_roles_user_id ON public.project_roles USING btree (user_id);
CREATE INDEX project_roles_project_id_idx ON public.project_roles USING btree (project_id);
CREATE INDEX idx_project_scope_documents_uploaded_by ON public.project_scope_documents USING btree (uploaded_by);
CREATE INDEX project_scope_documents_project_id_created_at_idx ON public.project_scope_documents USING btree (project_id, created_at DESC);
CREATE INDEX project_scope_items_change_request_id_idx ON public.project_scope_items USING btree (change_request_id);
CREATE UNIQUE INDEX project_scope_items_change_request_id_unique ON public.project_scope_items USING btree (change_request_id) WHERE ((source = 'change_request'::text) AND (change_request_id IS NOT NULL));
CREATE INDEX project_scope_items_project_id_position_idx ON public.project_scope_items USING btree (project_id, "position");
CREATE INDEX project_statuses_project_id_idx ON public.project_statuses USING btree (project_id);
CREATE UNIQUE INDEX project_statuses_project_id_name_idx ON public.project_statuses USING btree (project_id, name);
CREATE INDEX project_statuses_project_id_position_idx ON public.project_statuses USING btree (project_id, "position");
CREATE INDEX idx_projects_archived_by ON public.projects USING btree (archived_by);
CREATE INDEX idx_projects_created_by ON public.projects USING btree (created_by);
CREATE INDEX projects_workspace_id_idx ON public.projects USING btree (workspace_id);
CREATE INDEX projects_workspace_id_sidebar_position_idx ON public.projects USING btree (workspace_id, sidebar_position);
CREATE UNIQUE INDEX saved_views_owner_default_per_project_idx ON public.saved_views USING btree (owner_id, project_id) WHERE is_default;
CREATE INDEX saved_views_owner_id_idx ON public.saved_views USING btree (owner_id);
CREATE INDEX saved_views_project_id_idx ON public.saved_views USING btree (project_id);
CREATE INDEX saved_views_project_id_view_type_position_idx ON public.saved_views USING btree (project_id, view_type, "position");
CREATE INDEX saved_views_workspace_id_idx ON public.saved_views USING btree (workspace_id);
CREATE INDEX status_template_items_template_id_idx ON public.status_template_items USING btree (template_id);
CREATE INDEX status_template_items_template_id_position_idx ON public.status_template_items USING btree (template_id, "position");
CREATE INDEX idx_status_templates_created_by ON public.status_templates USING btree (created_by);
CREATE INDEX status_templates_workspace_id_idx ON public.status_templates USING btree (workspace_id);
CREATE UNIQUE INDEX status_templates_workspace_id_name_idx ON public.status_templates USING btree (workspace_id, name);
CREATE INDEX idx_task_activity_actor_id ON public.task_activity USING btree (actor_id);
CREATE INDEX task_activity_task_id_created_at_idx ON public.task_activity USING btree (task_id, created_at DESC);
CREATE INDEX idx_task_assignees_assigned_by ON public.task_assignees USING btree (assigned_by);
CREATE INDEX task_assignees_user_id_idx ON public.task_assignees USING btree (user_id);
CREATE INDEX task_custom_field_values_field_id_idx ON public.task_custom_field_values USING btree (field_id);
CREATE INDEX idx_task_dependencies_created_by ON public.task_dependencies USING btree (created_by);
CREATE INDEX task_dependencies_blocked_task_id_idx ON public.task_dependencies USING btree (blocked_task_id);
CREATE INDEX task_templates_created_by_idx ON public.task_templates USING btree (created_by);
CREATE INDEX task_templates_workspace_id_idx ON public.task_templates USING btree (workspace_id);
CREATE INDEX task_templates_workspace_id_kind_idx ON public.task_templates USING btree (workspace_id, kind);
CREATE INDEX task_types_workspace_id_idx ON public.task_types USING btree (workspace_id);
CREATE UNIQUE INDEX task_types_workspace_id_name_idx ON public.task_types USING btree (workspace_id, name);
CREATE INDEX task_types_workspace_id_position_idx ON public.task_types USING btree (workspace_id, "position");
CREATE UNIQUE INDEX task_types_workspace_id_system_key_idx ON public.task_types USING btree (workspace_id, system_key) WHERE (system_key IS NOT NULL);
CREATE INDEX task_watchers_user_id_idx ON public.task_watchers USING btree (user_id);
CREATE INDEX idx_tasks_author_id ON public.tasks USING btree (author_id);
CREATE INDEX idx_tasks_deleted_by ON public.tasks USING btree (deleted_by);
CREATE INDEX tasks_assignee_id_idx ON public.tasks USING btree (assignee_id);
CREATE INDEX tasks_deleted_via_task_id_idx ON public.tasks USING btree (deleted_via_task_id);
CREATE INDEX tasks_parent_task_id_idx ON public.tasks USING btree (parent_task_id);
CREATE INDEX tasks_phase_id_idx ON public.tasks USING btree (phase_id);
CREATE INDEX tasks_project_id_client_visible_idx ON public.tasks USING btree (project_id) WHERE client_visible;
CREATE INDEX tasks_project_id_idx ON public.tasks USING btree (project_id);
CREATE UNIQUE INDEX tasks_project_id_number_idx ON public.tasks USING btree (project_id, number);
CREATE INDEX tasks_project_id_page_order_idx ON public.tasks USING btree (project_id, page_order);
CREATE INDEX tasks_project_id_pending_client_approval_idx ON public.tasks USING btree (project_id) WHERE pending_client_approval;
CREATE INDEX tasks_project_id_status_idx ON public.tasks USING btree (project_id, status);
CREATE INDEX tasks_project_open_idx ON public.tasks USING btree (project_id) WHERE (deleted_at IS NULL);
CREATE INDEX tasks_recurrence_active_idx ON public.tasks USING btree (id) WHERE ((recurrence IS NOT NULL) AND (deleted_at IS NULL));
CREATE INDEX tasks_search_vector_idx ON public.tasks USING gin (search_vector);
CREATE INDEX tasks_start_date_idx ON public.tasks USING btree (start_date);
CREATE INDEX tasks_status_id_idx ON public.tasks USING btree (status_id);
CREATE INDEX tasks_status_idx ON public.tasks USING btree (status);
CREATE INDEX tasks_task_type_id_idx ON public.tasks USING btree (task_type_id);
CREATE INDEX time_entries_task_id_idx ON public.time_entries USING btree (task_id);
CREATE INDEX time_entries_user_id_idx ON public.time_entries USING btree (user_id);
CREATE INDEX time_off_entries_user_id_idx ON public.time_off_entries USING btree (user_id);
CREATE INDEX time_off_entries_workspace_id_start_date_idx ON public.time_off_entries USING btree (workspace_id, start_date);
CREATE INDEX idx_view_tasks_added_by ON public.view_tasks USING btree (added_by);
CREATE INDEX view_tasks_task_id_idx ON public.view_tasks USING btree (task_id);
CREATE INDEX view_tasks_view_id_idx ON public.view_tasks USING btree (view_id);
CREATE INDEX idx_workspace_members_invited_project_id ON public.workspace_members USING btree (invited_project_id);
CREATE INDEX workspace_members_user_id_idx ON public.workspace_members USING btree (user_id);
CREATE INDEX workspace_members_workspace_id_idx ON public.workspace_members USING btree (workspace_id);
CREATE UNIQUE INDEX workspace_members_workspace_invited_email_unique ON public.workspace_members USING btree (workspace_id, invited_email) WHERE (invited_email IS NOT NULL);
CREATE UNIQUE INDEX workspace_members_workspace_user_unique ON public.workspace_members USING btree (workspace_id, user_id) WHERE (user_id IS NOT NULL);
CREATE INDEX workspace_slug_history_workspace_id_idx ON public.workspace_slug_history USING btree (workspace_id);
CREATE INDEX workspaces_slug_idx ON public.workspaces USING btree (slug);

-- =============================== triggers ==============================

CREATE TRIGGER ai_threads_set_updated_at BEFORE UPDATE ON public.ai_threads FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER approval_requests_block_settled_update BEFORE UPDATE ON public.approval_requests FOR EACH ROW EXECUTE FUNCTION prevent_approval_request_settled_update();
CREATE TRIGGER approval_requests_set_updated_at BEFORE UPDATE ON public.approval_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER client_requests_sync_decision_from_approval AFTER UPDATE ON public.approval_requests FOR EACH ROW EXECUTE FUNCTION client_requests_sync_decision_from_approval();
CREATE TRIGGER board_swimlane_prefs_set_updated_at BEFORE UPDATE ON public.board_swimlane_prefs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER calendar_blocks_set_updated_at BEFORE UPDATE ON public.calendar_blocks FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER client_deliverables_clear_swept_at BEFORE UPDATE ON public.client_deliverables FOR EACH ROW EXECUTE FUNCTION clear_client_deliverable_swept_at();
CREATE TRIGGER client_deliverables_set_updated_at BEFORE UPDATE ON public.client_deliverables FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER client_requests_enforce_triage_columns_immutable_by_author BEFORE INSERT OR UPDATE ON public.client_requests FOR EACH ROW EXECUTE FUNCTION enforce_client_requests_triage_columns_immutable_by_author();
CREATE TRIGGER client_requests_set_updated_at BEFORE UPDATE ON public.client_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER comments_edit_author_only BEFORE UPDATE ON public.comments FOR EACH ROW EXECUTE FUNCTION enforce_comment_edit_author_only();
CREATE TRIGGER doc_folders_check_scope BEFORE INSERT OR UPDATE ON public.doc_folders FOR EACH ROW EXECUTE FUNCTION check_doc_folder_scope();
CREATE TRIGGER doc_links_set_updated_at BEFORE UPDATE ON public.doc_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER docs_set_updated_at BEFORE UPDATE ON public.docs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER notification_preferences_set_updated_at BEFORE UPDATE ON public.notification_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER page_links_set_updated_at BEFORE UPDATE ON public.page_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER personal_todos_set_updated_at BEFORE UPDATE ON public.personal_todos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_accounts_set_updated_at BEFORE UPDATE ON public.project_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_assumptions_set_updated_at BEFORE UPDATE ON public.project_assumptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_budgets_set_updated_at BEFORE UPDATE ON public.project_budgets FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_decision_owners_set_updated_at BEFORE UPDATE ON public.project_decision_owners FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_improvements_set_updated_at BEFORE UPDATE ON public.project_improvements FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_links_set_updated_at BEFORE UPDATE ON public.project_links FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_metrics_prevent_frozen_baseline_delete BEFORE DELETE ON public.project_metrics FOR EACH ROW EXECUTE FUNCTION prevent_frozen_baseline_update();
CREATE TRIGGER project_metrics_prevent_frozen_baseline_update BEFORE UPDATE ON public.project_metrics FOR EACH ROW EXECUTE FUNCTION prevent_frozen_baseline_update();
CREATE TRIGGER project_metrics_set_updated_at BEFORE UPDATE ON public.project_metrics FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_phases_set_updated_at BEFORE UPDATE ON public.project_phases FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_roles_set_updated_at BEFORE UPDATE ON public.project_roles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER project_statuses_prevent_last_delete BEFORE DELETE ON public.project_statuses FOR EACH ROW EXECUTE FUNCTION prevent_last_project_status_delete();
CREATE TRIGGER project_statuses_sync_task_status_on_rename AFTER UPDATE OF name ON public.project_statuses FOR EACH ROW EXECUTE FUNCTION sync_tasks_status_on_column_rename();
CREATE TRIGGER projects_assign_key BEFORE INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION assign_project_key();
CREATE TRIGGER projects_enforce_field_role_allowlist BEFORE INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION enforce_projects_field_role_allowlist();
CREATE TRIGGER projects_enforce_visibility_change_role BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION enforce_project_visibility_change_role();
CREATE TRIGGER projects_seed_default_statuses AFTER INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION seed_default_project_statuses_on_insert();
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER saved_views_set_updated_at BEFORE UPDATE ON public.saved_views FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER task_custom_field_values_set_updated_at BEFORE UPDATE ON public.task_custom_field_values FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER task_dependencies_enforce_no_cycle BEFORE INSERT ON public.task_dependencies FOR EACH ROW EXECUTE FUNCTION enforce_task_dependency_no_cycle();
CREATE TRIGGER task_dependencies_enforce_same_workspace BEFORE INSERT ON public.task_dependencies FOR EACH ROW EXECUTE FUNCTION enforce_task_dependency_same_workspace();
CREATE TRIGGER task_types_lock_system_flags_trigger BEFORE UPDATE ON public.task_types FOR EACH ROW EXECUTE FUNCTION task_types_lock_system_flags();
CREATE TRIGGER tasks_assign_number BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION assign_task_number();
CREATE TRIGGER tasks_default_task_type_trigger BEFORE INSERT ON public.tasks FOR EACH ROW EXECUTE FUNCTION tasks_default_task_type();
CREATE TRIGGER tasks_enforce_parent_rules BEFORE INSERT OR UPDATE OF parent_task_id, project_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION enforce_task_parent_rules();
CREATE TRIGGER tasks_search_vector_trigger BEFORE INSERT OR UPDATE OF title, description, description_json, number, project_id ON public.tasks FOR EACH ROW EXECUTE FUNCTION tasks_update_search_vector();
CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW WHEN (((old.project_id IS DISTINCT FROM new.project_id) OR (old.title IS DISTINCT FROM new.title) OR (old.description IS DISTINCT FROM new.description) OR (old.status IS DISTINCT FROM new.status) OR (old.priority IS DISTINCT FROM new.priority) OR (old.tags IS DISTINCT FROM new.tags) OR (old.start_date IS DISTINCT FROM new.start_date) OR (old.due_date IS DISTINCT FROM new.due_date) OR (old.points IS DISTINCT FROM new.points) OR (old.author_id IS DISTINCT FROM new.author_id) OR (old.assignee_id IS DISTINCT FROM new.assignee_id) OR (old.deleted_at IS DISTINCT FROM new.deleted_at))) EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER tasks_sync_status_and_status_id BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION sync_task_status_and_status_id();
CREATE TRIGGER time_entries_set_updated_at BEFORE UPDATE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ========================== row level security =========================

alter table public._realtime_capability_probe enable row level security;
alter table public.active_timers enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_threads enable row level security;
alter table public.approval_requests enable row level security;
alter table public.attachments enable row level security;
alter table public.audit_log enable row level security;
alter table public.board_swimlane_prefs enable row level security;
alter table public.calendar_blocks enable row level security;
alter table public.channel_members enable row level security;
alter table public.channels enable row level security;
alter table public.checklist_items enable row level security;
alter table public.client_deliverables enable row level security;
alter table public.client_requests enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.comments enable row level security;
alter table public.doc_folders enable row level security;
alter table public.doc_links enable row level security;
alter table public.docs enable row level security;
alter table public.f016i_gated_function_oids enable row level security;
alter table public.message_attachments enable row level security;
alter table public.message_reactions enable row level security;
alter table public.messages enable row level security;
alter table public.metric_snapshots enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.page_links enable row level security;
alter table public.personal_todos enable row level security;
alter table public.profiles enable row level security;
alter table public.project_accounts enable row level security;
alter table public.project_assumptions enable row level security;
alter table public.project_budgets enable row level security;
alter table public.project_custom_fields enable row level security;
alter table public.project_decision_owners enable row level security;
alter table public.project_decision_types enable row level security;
alter table public.project_decisions enable row level security;
alter table public.project_favorites enable row level security;
alter table public.project_improvements enable row level security;
alter table public.project_links enable row level security;
alter table public.project_members enable row level security;
alter table public.project_metrics enable row level security;
alter table public.project_phases enable row level security;
alter table public.project_roles enable row level security;
alter table public.project_scope_documents enable row level security;
alter table public.project_scope_items enable row level security;
alter table public.project_statuses enable row level security;
alter table public.projects enable row level security;
alter table public.saved_views enable row level security;
alter table public.status_template_items enable row level security;
alter table public.status_templates enable row level security;
alter table public.task_activity enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_custom_field_values enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_templates enable row level security;
alter table public.task_types enable row level security;
alter table public.task_watchers enable row level security;
alter table public.tasks enable row level security;
alter table public.time_entries enable row level security;
alter table public.time_off_entries enable row level security;
alter table public.view_tasks enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_slug_history enable row level security;
alter table public.workspaces enable row level security;

create policy "active_timers_delete_active_members" on public.active_timers
  as permissive
  for delete
  to authenticated
  using (is_task_workspace_member(task_id));

create policy "active_timers_insert_active_members" on public.active_timers
  as permissive
  for insert
  to authenticated
  with check (is_task_workspace_member(task_id));

create policy "active_timers_select_active_members" on public.active_timers
  as permissive
  for select
  to authenticated
  using ((is_task_workspace_member(task_id) AND (NOT is_task_client(task_id))));

create policy "ai_messages_delete_via_thread" on public.ai_messages
  as permissive
  for delete
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM ai_threads t
  WHERE ((t.id = ai_messages.thread_id) AND is_active_workspace_member(t.workspace_id) AND can_write_workspace_docs(t.workspace_id)))));

create policy "ai_messages_deny_portal_clients" on public.ai_messages
  as restrictive
  for all
  to authenticated
  using ((NOT (EXISTS ( SELECT 1
   FROM ai_threads t
  WHERE ((t.id = ai_messages.thread_id) AND (t.project_id IS NOT NULL) AND is_project_client(t.project_id))))))
  with check ((NOT (EXISTS ( SELECT 1
   FROM ai_threads t
  WHERE ((t.id = ai_messages.thread_id) AND (t.project_id IS NOT NULL) AND is_project_client(t.project_id))))));

create policy "ai_messages_insert_via_thread" on public.ai_messages
  as permissive
  for insert
  to authenticated
  with check ((EXISTS ( SELECT 1
   FROM ai_threads t
  WHERE ((t.id = ai_messages.thread_id) AND is_active_workspace_member(t.workspace_id) AND can_write_workspace_docs(t.workspace_id)))));

create policy "ai_messages_select_via_thread" on public.ai_messages
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM ai_threads t
  WHERE ((t.id = ai_messages.thread_id) AND is_active_workspace_member(t.workspace_id) AND can_read_workspace_docs(t.workspace_id)))));

create policy "ai_messages_update_via_thread" on public.ai_messages
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM ai_threads t
  WHERE ((t.id = ai_messages.thread_id) AND is_active_workspace_member(t.workspace_id) AND can_write_workspace_docs(t.workspace_id)))))
  with check ((EXISTS ( SELECT 1
   FROM ai_threads t
  WHERE ((t.id = ai_messages.thread_id) AND is_active_workspace_member(t.workspace_id) AND can_write_workspace_docs(t.workspace_id)))));

create policy "ai_threads_delete_active_members" on public.ai_threads
  as permissive
  for delete
  to authenticated
  using ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id)));

create policy "ai_threads_deny_portal_clients" on public.ai_threads
  as restrictive
  for all
  to authenticated
  using ((NOT is_project_client(COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid))))
  with check ((NOT is_project_client(COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid))));

create policy "ai_threads_insert_active_members" on public.ai_threads
  as permissive
  for insert
  to authenticated
  with check ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id) AND (created_by = ( SELECT auth.uid() AS uid))));

create policy "ai_threads_select_active_members" on public.ai_threads
  as permissive
  for select
  to authenticated
  using ((is_active_workspace_member(workspace_id) AND can_read_workspace_docs(workspace_id)));

create policy "ai_threads_update_active_members" on public.ai_threads
  as permissive
  for update
  to authenticated
  using ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id)))
  with check ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id)));

create policy "approval_requests_insert_team" on public.approval_requests
  as permissive
  for insert
  to authenticated
  with check ((is_project_workspace_writer(project_id) AND (requested_by = ( SELECT auth.uid() AS uid)) AND ((subject_type <> 'task'::text) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = approval_requests.subject_id) AND t.client_visible AND (t.deleted_at IS NULL)))))));

create policy "approval_requests_select_client" on public.approval_requests
  as permissive
  for select
  to authenticated
  using ((is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id) AND ((subject_type <> 'task'::text) OR (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = approval_requests.subject_id) AND t.client_visible AND (t.deleted_at IS NULL)))))));

create policy "approval_requests_select_team" on public.approval_requests
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "approval_requests_update_team" on public.approval_requests
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check ((is_project_workspace_writer(project_id) AND (state = 'pending'::text) AND (decided_by IS NULL) AND (decided_at IS NULL)));

create policy "attachments_insert_active_members" on public.attachments
  as permissive
  for insert
  to authenticated
  with check (is_task_workspace_writer(task_id));

create policy "attachments_select_active_members" on public.attachments
  as permissive
  for select
  to authenticated
  using (is_task_visible_to(task_id));

create policy "audit_log_select_owner_admin" on public.audit_log
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = audit_log.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "board_swimlane_prefs_insert_own" on public.board_swimlane_prefs
  as permissive
  for insert
  to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "board_swimlane_prefs_select_own" on public.board_swimlane_prefs
  as permissive
  for select
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "board_swimlane_prefs_update_own" on public.board_swimlane_prefs
  as permissive
  for update
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "calendar_blocks_delete_own" on public.calendar_blocks
  as permissive
  for delete
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "calendar_blocks_insert_visible" on public.calendar_blocks
  as permissive
  for insert
  to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (((project_id IS NOT NULL) AND is_project_visible_to(project_id)) OR ((project_id IS NULL) AND is_active_workspace_member(workspace_id)))));

create policy "calendar_blocks_select_visible" on public.calendar_blocks
  as permissive
  for select
  to authenticated
  using ((((project_id IS NOT NULL) AND is_project_visible_to(project_id)) OR ((project_id IS NULL) AND is_active_workspace_member(workspace_id))));

create policy "calendar_blocks_update_own" on public.calendar_blocks
  as permissive
  for update
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (((project_id IS NOT NULL) AND is_project_visible_to(project_id)) OR ((project_id IS NULL) AND is_active_workspace_member(workspace_id)))));

create policy "channel_members_delete_self_or_existing_member" on public.channel_members
  as permissive
  for delete
  to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM channel_members cm2
  WHERE ((cm2.channel_id = channel_members.channel_id) AND (cm2.user_id = ( SELECT auth.uid() AS uid)))))));

create policy "channel_members_insert_self_or_existing_member" on public.channel_members
  as permissive
  for insert
  to authenticated
  with check ((((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM channels c
  WHERE (c.id = channel_members.channel_id)))) OR (EXISTS ( SELECT 1
   FROM channel_members cm2
  WHERE ((cm2.channel_id = channel_members.channel_id) AND (cm2.user_id = ( SELECT auth.uid() AS uid)))))));

create policy "channel_members_select_own" on public.channel_members
  as permissive
  for select
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "channel_members_select_own_or_shared_channel" on public.channel_members
  as permissive
  for select
  to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR is_channel_member(channel_id)));

create policy "channel_members_update_own" on public.channel_members
  as permissive
  for update
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "channels_insert_active_members" on public.channels
  as permissive
  for insert
  to authenticated
  with check (((created_by = ( SELECT auth.uid() AS uid)) AND is_active_workspace_member(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))));

create policy "channels_select_members_or_workspace" on public.channels
  as permissive
  for select
  to authenticated
  using (((EXISTS ( SELECT 1
   FROM channel_members cm
  WHERE ((cm.channel_id = channels.id) AND (cm.user_id = ( SELECT auth.uid() AS uid))))) OR ((kind = 'channel'::text) AND (((project_id IS NULL) AND is_active_workspace_member(workspace_id) AND (NOT is_workspace_client(workspace_id))) OR ((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM project_members pm
  WHERE ((pm.project_id = channels.project_id) AND (pm.user_id = ( SELECT auth.uid() AS uid))))))))));

create policy "checklist_items_delete_active_members" on public.checklist_items
  as permissive
  for delete
  to authenticated
  using (is_task_visible_to(task_id));

create policy "checklist_items_insert_active_members" on public.checklist_items
  as permissive
  for insert
  to authenticated
  with check (is_task_visible_to(task_id));

create policy "checklist_items_select_active_members" on public.checklist_items
  as permissive
  for select
  to authenticated
  using (is_task_visible_to(task_id));

create policy "checklist_items_update_active_members" on public.checklist_items
  as permissive
  for update
  to authenticated
  using (is_task_visible_to(task_id))
  with check (is_task_visible_to(task_id));

create policy "client_deliverables_delete_team" on public.client_deliverables
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "client_deliverables_insert_team" on public.client_deliverables
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "client_deliverables_select_client" on public.client_deliverables
  as permissive
  for select
  to authenticated
  using ((is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "client_deliverables_select_team" on public.client_deliverables
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "client_deliverables_update_team" on public.client_deliverables
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "client_requests_delete_author_while_submitted" on public.client_requests
  as permissive
  for delete
  to authenticated
  using (((created_by = ( SELECT auth.uid() AS uid)) AND (status = 'submitted'::text) AND is_project_portal_enabled(project_id)));

create policy "client_requests_insert_own" on public.client_requests
  as permissive
  for insert
  to authenticated
  with check (((created_by = ( SELECT auth.uid() AS uid)) AND is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id) AND (status = 'submitted'::text) AND (converted_task_id IS NULL) AND (reviewed_by IS NULL)));

create policy "client_requests_select_author_or_team" on public.client_requests
  as permissive
  for select
  to authenticated
  using (((is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)) OR (is_project_visible_to(project_id) AND (NOT is_project_client(project_id)))));

create policy "client_requests_update_author_while_submitted" on public.client_requests
  as permissive
  for update
  to authenticated
  using (((created_by = ( SELECT auth.uid() AS uid)) AND (status = 'submitted'::text) AND is_project_portal_enabled(project_id)))
  with check (((created_by = ( SELECT auth.uid() AS uid)) AND (status = 'submitted'::text) AND (converted_task_id IS NULL) AND (reviewed_by IS NULL) AND is_project_portal_enabled(project_id)));

create policy "client_requests_update_team" on public.client_requests
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "comment_reactions_delete_self" on public.comment_reactions
  as permissive
  for delete
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "comment_reactions_insert_self" on public.comment_reactions
  as permissive
  for insert
  to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM comments c
  WHERE ((c.id = comment_reactions.comment_id) AND (c.deleted_at IS NULL) AND (c.task_id = comment_reactions.task_id) AND is_task_visible_to(c.task_id))))));

create policy "comment_reactions_select_visible" on public.comment_reactions
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM comments c
  WHERE ((c.id = comment_reactions.comment_id) AND (c.deleted_at IS NULL) AND is_task_visible_to(c.task_id)))));

create policy "comments_insert_active_members" on public.comments
  as permissive
  for insert
  to authenticated
  with check ((is_task_workspace_writer(task_id) OR (is_task_client(task_id) AND is_task_visible_to(task_id) AND (user_id = ( SELECT auth.uid() AS uid)) AND (internal = false))));

create policy "comments_select_active_members" on public.comments
  as permissive
  for select
  to authenticated
  using (((deleted_at IS NULL) AND is_task_visible_to(task_id) AND ((NOT internal) OR (NOT is_task_client(task_id)))));

create policy "comments_select_trash_visible_members" on public.comments
  as permissive
  for select
  to authenticated
  using (((deleted_at IS NOT NULL) AND is_task_visible_to(task_id) AND (NOT is_task_client(task_id))));

create policy "comments_update_author_or_admin" on public.comments
  as permissive
  for update
  to authenticated
  using (can_modify_comment(id))
  with check (can_modify_comment(id));

create policy "doc_folders_delete_active_members" on public.doc_folders
  as permissive
  for delete
  to authenticated
  using ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))));

create policy "doc_folders_insert_active_members" on public.doc_folders
  as permissive
  for insert
  to authenticated
  with check ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))));

create policy "doc_folders_select_active_members" on public.doc_folders
  as permissive
  for select
  to authenticated
  using ((is_active_workspace_member(workspace_id) AND can_read_workspace_docs(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))));

create policy "doc_folders_update_active_members" on public.doc_folders
  as permissive
  for update
  to authenticated
  using ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))))
  with check ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))));

create policy "doc_links_delete_team" on public.doc_links
  as permissive
  for delete
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM docs d
  WHERE ((d.id = doc_links.doc_id) AND is_active_workspace_member(d.workspace_id) AND can_read_workspace_docs(d.workspace_id)))));

create policy "doc_links_insert_team" on public.doc_links
  as permissive
  for insert
  to authenticated
  with check ((EXISTS ( SELECT 1
   FROM docs d
  WHERE ((d.id = doc_links.doc_id) AND is_active_workspace_member(d.workspace_id) AND can_read_workspace_docs(d.workspace_id)))));

create policy "doc_links_select_client" on public.doc_links
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM docs d
  WHERE ((d.id = doc_links.doc_id) AND d.client_visible AND (d.project_id IS NOT NULL) AND is_project_client(d.project_id) AND is_project_visible_to(d.project_id) AND is_project_portal_enabled(d.project_id)))));

create policy "doc_links_select_team" on public.doc_links
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM docs d
  WHERE ((d.id = doc_links.doc_id) AND is_active_workspace_member(d.workspace_id) AND can_read_workspace_docs(d.workspace_id)))));

create policy "doc_links_update_team" on public.doc_links
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM docs d
  WHERE ((d.id = doc_links.doc_id) AND is_active_workspace_member(d.workspace_id) AND can_read_workspace_docs(d.workspace_id)))))
  with check ((EXISTS ( SELECT 1
   FROM docs d
  WHERE ((d.id = doc_links.doc_id) AND is_active_workspace_member(d.workspace_id) AND can_read_workspace_docs(d.workspace_id)))));

create policy "docs_delete_active_members" on public.docs
  as permissive
  for delete
  to authenticated
  using ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))));

create policy "docs_insert_active_members" on public.docs
  as permissive
  for insert
  to authenticated
  with check ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))));

create policy "docs_select_active_members" on public.docs
  as permissive
  for select
  to authenticated
  using ((is_active_workspace_member(workspace_id) AND can_read_workspace_docs(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))));

create policy "docs_select_client" on public.docs
  as permissive
  for select
  to authenticated
  using ((client_visible AND (project_id IS NOT NULL) AND is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "docs_update_active_members" on public.docs
  as permissive
  for update
  to authenticated
  using ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))))
  with check ((is_active_workspace_member(workspace_id) AND can_write_workspace_docs(workspace_id) AND ((project_id IS NULL) OR is_project_visible_to(project_id))));

create policy "message_attachments_delete_own" on public.message_attachments
  as permissive
  for delete
  to authenticated
  using ((uploaded_by = ( SELECT auth.uid() AS uid)));

create policy "message_attachments_insert_channel_members" on public.message_attachments
  as permissive
  for insert
  to authenticated
  with check (((uploaded_by = ( SELECT auth.uid() AS uid)) AND (message_id IS NULL) AND (EXISTS ( SELECT 1
   FROM channel_members cm
  WHERE ((cm.channel_id = message_attachments.channel_id) AND (cm.user_id = ( SELECT auth.uid() AS uid)))))));

create policy "message_attachments_select_channel_members" on public.message_attachments
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM channel_members cm
  WHERE ((cm.channel_id = message_attachments.channel_id) AND (cm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "message_attachments_update_link_own_pending" on public.message_attachments
  as permissive
  for update
  to authenticated
  using (((uploaded_by = ( SELECT auth.uid() AS uid)) AND (message_id IS NULL)))
  with check (((uploaded_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_attachments.message_id) AND (m.channel_id = message_attachments.channel_id) AND (m.sender_id = ( SELECT auth.uid() AS uid)))))));

create policy "message_reactions_delete_self" on public.message_reactions
  as permissive
  for delete
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "message_reactions_insert_self" on public.message_reactions
  as permissive
  for insert
  to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (messages m
     JOIN channel_members cm ON ((cm.channel_id = m.channel_id)))
  WHERE ((m.id = message_reactions.message_id) AND (m.channel_id = message_reactions.channel_id) AND (cm.user_id = ( SELECT auth.uid() AS uid)))))));

create policy "message_reactions_select_visible" on public.message_reactions
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM (messages m
     JOIN channel_members cm ON ((cm.channel_id = m.channel_id)))
  WHERE ((m.id = message_reactions.message_id) AND (cm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "messages_insert_channel_members" on public.messages
  as permissive
  for insert
  to authenticated
  with check (((sender_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM channel_members cm
  WHERE ((cm.channel_id = messages.channel_id) AND (cm.user_id = ( SELECT auth.uid() AS uid)))))));

create policy "messages_select_channel_members" on public.messages
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM channel_members cm
  WHERE ((cm.channel_id = messages.channel_id) AND (cm.user_id = ( SELECT auth.uid() AS uid))))));

create policy "messages_update_sender_only" on public.messages
  as permissive
  for update
  to authenticated
  using ((sender_id = ( SELECT auth.uid() AS uid)))
  with check ((sender_id = ( SELECT auth.uid() AS uid)));

create policy "metric_snapshots_delete_team" on public.metric_snapshots
  as permissive
  for delete
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM project_metrics pm
  WHERE ((pm.id = metric_snapshots.metric_id) AND is_project_workspace_writer(pm.project_id)))));

create policy "metric_snapshots_insert_team" on public.metric_snapshots
  as permissive
  for insert
  to authenticated
  with check (((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM project_metrics pm
  WHERE ((pm.id = metric_snapshots.metric_id) AND is_project_workspace_writer(pm.project_id))))));

create policy "metric_snapshots_select_client" on public.metric_snapshots
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM project_metrics pm
  WHERE ((pm.id = metric_snapshots.metric_id) AND pm.client_visible AND is_project_client(pm.project_id) AND is_project_visible_to(pm.project_id) AND is_project_portal_enabled(pm.project_id)))));

create policy "metric_snapshots_select_team" on public.metric_snapshots
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM project_metrics pm
  WHERE ((pm.id = metric_snapshots.metric_id) AND is_project_visible_to(pm.project_id) AND (NOT is_project_client(pm.project_id))))));

create policy "notification_preferences_insert_own" on public.notification_preferences
  as permissive
  for insert
  to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "notification_preferences_select_own" on public.notification_preferences
  as permissive
  for select
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "notification_preferences_update_own" on public.notification_preferences
  as permissive
  for update
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "notifications_select_own" on public.notifications
  as permissive
  for select
  to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (created_at >= (now() - '30 days'::interval))));

create policy "notifications_update_own" on public.notifications
  as permissive
  for update
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "page_links_delete_team" on public.page_links
  as permissive
  for delete
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = page_links.task_id) AND is_project_workspace_writer(t.project_id)))));

create policy "page_links_insert_team" on public.page_links
  as permissive
  for insert
  to authenticated
  with check ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = page_links.task_id) AND is_project_workspace_writer(t.project_id)))));

create policy "page_links_select_client" on public.page_links
  as permissive
  for select
  to authenticated
  using ((client_visible AND (EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = page_links.task_id) AND t.client_visible AND is_project_client(t.project_id) AND is_project_visible_to(t.project_id) AND is_project_portal_enabled(t.project_id))))));

create policy "page_links_select_team" on public.page_links
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = page_links.task_id) AND is_project_visible_to(t.project_id) AND (NOT is_project_client(t.project_id))))));

create policy "page_links_update_team" on public.page_links
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = page_links.task_id) AND is_project_workspace_writer(t.project_id)))))
  with check ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = page_links.task_id) AND is_project_workspace_writer(t.project_id)))));

create policy "personal_todos_owner_only" on public.personal_todos
  as permissive
  for all
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "profiles_select_self_or_shared_workspace" on public.profiles
  as permissive
  for select
  to authenticated
  using (((id = ( SELECT auth.uid() AS uid)) OR shares_non_client_workspace_with(id)));

create policy "profiles_update_self" on public.profiles
  as permissive
  for update
  to authenticated
  using ((id = ( SELECT auth.uid() AS uid)))
  with check ((id = ( SELECT auth.uid() AS uid)));

create policy "project_accounts_delete_team" on public.project_accounts
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_accounts_insert_team" on public.project_accounts
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_accounts_select_client" on public.project_accounts
  as permissive
  for select
  to authenticated
  using ((client_visible AND is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_accounts_select_team" on public.project_accounts
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_accounts_update_team" on public.project_accounts
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_assumptions_delete_team" on public.project_assumptions
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_assumptions_insert_team" on public.project_assumptions
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_assumptions_select_client" on public.project_assumptions
  as permissive
  for select
  to authenticated
  using ((client_visible AND is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_assumptions_select_team" on public.project_assumptions
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_assumptions_update_team" on public.project_assumptions
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_budgets_delete_team" on public.project_budgets
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_budgets_insert_team" on public.project_budgets
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_budgets_select_team" on public.project_budgets
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_budgets_update_team" on public.project_budgets
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_custom_fields_delete_writer" on public.project_custom_fields
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_custom_fields_insert_writer" on public.project_custom_fields
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_custom_fields_select_visible" on public.project_custom_fields
  as permissive
  for select
  to authenticated
  using (is_project_visible_to(project_id));

create policy "project_custom_fields_update_writer" on public.project_custom_fields
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_decision_owners_delete_team" on public.project_decision_owners
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_decision_owners_insert_team" on public.project_decision_owners
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_decision_owners_select_client" on public.project_decision_owners
  as permissive
  for select
  to authenticated
  using ((is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_decision_owners_select_team" on public.project_decision_owners
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_decision_owners_update_team" on public.project_decision_owners
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_decision_types_delete_team" on public.project_decision_types
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_decision_types_insert_team" on public.project_decision_types
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_decision_types_select_client" on public.project_decision_types
  as permissive
  for select
  to authenticated
  using ((is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_decision_types_select_team" on public.project_decision_types
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_decision_types_update_team" on public.project_decision_types
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_decisions_delete_team" on public.project_decisions
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_decisions_insert_team" on public.project_decisions
  as permissive
  for insert
  to authenticated
  with check ((is_project_workspace_writer(project_id) AND (created_by = ( SELECT auth.uid() AS uid))));

create policy "project_decisions_select_client" on public.project_decisions
  as permissive
  for select
  to authenticated
  using ((client_visible AND is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_decisions_select_team" on public.project_decisions
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_decisions_update_team" on public.project_decisions
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_favorites_delete_own" on public.project_favorites
  as permissive
  for delete
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "project_favorites_insert_own" on public.project_favorites
  as permissive
  for insert
  to authenticated
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "project_favorites_select_own" on public.project_favorites
  as permissive
  for select
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "project_improvements_delete_team" on public.project_improvements
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_improvements_insert_team" on public.project_improvements
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_improvements_select_client" on public.project_improvements
  as permissive
  for select
  to authenticated
  using ((client_visible AND is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_improvements_select_team" on public.project_improvements
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_improvements_update_team" on public.project_improvements
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_links_delete_team" on public.project_links
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_links_insert_team" on public.project_links
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_links_select_client" on public.project_links
  as permissive
  for select
  to authenticated
  using ((client_visible AND is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_links_select_team" on public.project_links
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_links_update_team" on public.project_links
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_members_delete_leads_or_admins" on public.project_members
  as permissive
  for delete
  to authenticated
  using (is_project_lead_or_workspace_admin(project_id));

create policy "project_members_insert_leads_or_admins" on public.project_members
  as permissive
  for insert
  to authenticated
  with check (is_project_lead_or_workspace_admin(project_id));

create policy "project_members_select_active_members" on public.project_members
  as permissive
  for select
  to authenticated
  using ((is_project_workspace_member(project_id) AND ((NOT is_project_client(project_id)) OR (user_id = ( SELECT auth.uid() AS uid)))));

create policy "project_metrics_delete_team" on public.project_metrics
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_metrics_insert_team" on public.project_metrics
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_metrics_select_client" on public.project_metrics
  as permissive
  for select
  to authenticated
  using ((client_visible AND is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_metrics_select_team" on public.project_metrics
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_metrics_update_team" on public.project_metrics
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_phases_delete_team" on public.project_phases
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_phases_insert_team" on public.project_phases
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_phases_select_client" on public.project_phases
  as permissive
  for select
  to authenticated
  using ((client_visible AND is_project_visible_to(project_id) AND is_project_client(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_phases_select_team" on public.project_phases
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_phases_update_team" on public.project_phases
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_roles_delete_team" on public.project_roles
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_roles_insert_team" on public.project_roles
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_roles_select_client" on public.project_roles
  as permissive
  for select
  to authenticated
  using ((is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_roles_select_team" on public.project_roles
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_roles_update_team" on public.project_roles
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_scope_documents_delete_team" on public.project_scope_documents
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_scope_documents_insert_team" on public.project_scope_documents
  as permissive
  for insert
  to authenticated
  with check ((is_project_workspace_writer(project_id) AND (uploaded_by = ( SELECT auth.uid() AS uid))));

create policy "project_scope_documents_select_client" on public.project_scope_documents
  as permissive
  for select
  to authenticated
  using ((is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_scope_documents_select_team" on public.project_scope_documents
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_scope_items_delete_team" on public.project_scope_items
  as permissive
  for delete
  to authenticated
  using (is_project_workspace_writer(project_id));

create policy "project_scope_items_insert_team" on public.project_scope_items
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "project_scope_items_select_client" on public.project_scope_items
  as permissive
  for select
  to authenticated
  using ((is_project_client(project_id) AND is_project_visible_to(project_id) AND is_project_portal_enabled(project_id)));

create policy "project_scope_items_select_team" on public.project_scope_items
  as permissive
  for select
  to authenticated
  using ((is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "project_scope_items_update_team" on public.project_scope_items
  as permissive
  for update
  to authenticated
  using (is_project_workspace_writer(project_id))
  with check (is_project_workspace_writer(project_id));

create policy "project_statuses_delete_admin" on public.project_statuses
  as permissive
  for delete
  to authenticated
  using ((is_project_visible_to(project_id) AND is_project_lead_or_workspace_admin(project_id)));

create policy "project_statuses_insert_admin" on public.project_statuses
  as permissive
  for insert
  to authenticated
  with check ((is_project_visible_to(project_id) AND is_project_lead_or_workspace_admin(project_id)));

create policy "project_statuses_select_visible" on public.project_statuses
  as permissive
  for select
  to authenticated
  using (is_project_visible_to(project_id));

create policy "project_statuses_update_admin" on public.project_statuses
  as permissive
  for update
  to authenticated
  using ((is_project_visible_to(project_id) AND is_project_lead_or_workspace_admin(project_id)))
  with check ((is_project_visible_to(project_id) AND is_project_lead_or_workspace_admin(project_id)));

create policy "projects_insert_active_members" on public.projects
  as permissive
  for insert
  to authenticated
  with check (is_active_workspace_member(workspace_id));

create policy "projects_select_active_members" on public.projects
  as permissive
  for select
  to authenticated
  using (((deleted_at IS NULL) AND is_project_visible_to_row(id, workspace_id, visibility)));

create policy "projects_update_active_members" on public.projects
  as permissive
  for update
  to authenticated
  using (((deleted_at IS NULL) AND is_active_workspace_member(workspace_id)))
  with check (is_active_workspace_member(workspace_id));

create policy "saved_views_delete_own" on public.saved_views
  as permissive
  for delete
  to authenticated
  using ((owner_id = ( SELECT auth.uid() AS uid)));

create policy "saved_views_insert_visible" on public.saved_views
  as permissive
  for insert
  to authenticated
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (((project_id IS NOT NULL) AND is_project_visible_to(project_id)) OR ((project_id IS NULL) AND is_active_workspace_member(workspace_id)))));

create policy "saved_views_select_visible" on public.saved_views
  as permissive
  for select
  to authenticated
  using (((owner_id = ( SELECT auth.uid() AS uid)) OR ((scope = 'shared'::text) AND (((project_id IS NOT NULL) AND is_project_visible_to(project_id) AND (NOT is_project_client(project_id))) OR ((project_id IS NULL) AND is_active_workspace_member(workspace_id) AND (NOT is_workspace_client(workspace_id)))))));

create policy "saved_views_update_own" on public.saved_views
  as permissive
  for update
  to authenticated
  using ((owner_id = ( SELECT auth.uid() AS uid)))
  with check (((owner_id = ( SELECT auth.uid() AS uid)) AND (((project_id IS NOT NULL) AND is_project_visible_to(project_id)) OR ((project_id IS NULL) AND is_active_workspace_member(workspace_id)))));

create policy "status_template_items_select_active_members" on public.status_template_items
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM status_templates st
  WHERE ((st.id = status_template_items.template_id) AND is_active_workspace_member(st.workspace_id)))));

create policy "status_template_items_write_admins" on public.status_template_items
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM (status_templates st
     JOIN workspace_members wm ON ((wm.workspace_id = st.workspace_id)))
  WHERE ((st.id = status_template_items.template_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM (status_templates st
     JOIN workspace_members wm ON ((wm.workspace_id = st.workspace_id)))
  WHERE ((st.id = status_template_items.template_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "status_templates_select_active_members" on public.status_templates
  as permissive
  for select
  to authenticated
  using (is_active_workspace_member(workspace_id));

create policy "status_templates_write_admins" on public.status_templates
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = status_templates.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = status_templates.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "task_activity_select_visible_task" on public.task_activity
  as permissive
  for select
  to authenticated
  using ((is_task_visible_to(task_id) AND (NOT is_task_client(task_id))));

create policy "task_assignees_delete_visible" on public.task_assignees
  as permissive
  for delete
  to authenticated
  using (is_task_visible_to(task_id));

create policy "task_assignees_insert_visible" on public.task_assignees
  as permissive
  for insert
  to authenticated
  with check (is_task_visible_to(task_id));

create policy "task_assignees_select_visible" on public.task_assignees
  as permissive
  for select
  to authenticated
  using ((is_task_visible_to(task_id) AND (NOT is_task_client(task_id))));

create policy "task_assignees_update_visible" on public.task_assignees
  as permissive
  for update
  to authenticated
  using (is_task_visible_to(task_id))
  with check (is_task_visible_to(task_id));

create policy "task_custom_field_values_delete_writer" on public.task_custom_field_values
  as permissive
  for delete
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_custom_field_values.task_id) AND is_project_workspace_writer(t.project_id)))));

create policy "task_custom_field_values_insert_writer" on public.task_custom_field_values
  as permissive
  for insert
  to authenticated
  with check ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_custom_field_values.task_id) AND is_project_workspace_writer(t.project_id)))));

create policy "task_custom_field_values_select_visible" on public.task_custom_field_values
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_custom_field_values.task_id) AND is_project_visible_to(t.project_id)))));

create policy "task_custom_field_values_update_writer" on public.task_custom_field_values
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_custom_field_values.task_id) AND is_project_workspace_writer(t.project_id)))))
  with check ((EXISTS ( SELECT 1
   FROM tasks t
  WHERE ((t.id = task_custom_field_values.task_id) AND is_project_workspace_writer(t.project_id)))));

create policy "task_dependencies_delete_active_members" on public.task_dependencies
  as permissive
  for delete
  to authenticated
  using ((is_task_visible_to(blocking_task_id) AND is_task_visible_to(blocked_task_id)));

create policy "task_dependencies_insert_active_members" on public.task_dependencies
  as permissive
  for insert
  to authenticated
  with check ((is_task_visible_to(blocking_task_id) AND is_task_visible_to(blocked_task_id)));

create policy "task_dependencies_select_active_members" on public.task_dependencies
  as permissive
  for select
  to authenticated
  using ((is_task_visible_to(blocking_task_id) AND is_task_visible_to(blocked_task_id)));

create policy "task_templates_delete_owner_or_admin" on public.task_templates
  as permissive
  for delete
  to authenticated
  using (((created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = task_templates.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));

create policy "task_templates_insert_own_non_guest" on public.task_templates
  as permissive
  for insert
  to authenticated
  with check (((created_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = task_templates.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role <> 'guest'::text))))));

create policy "task_templates_select_non_guest_members" on public.task_templates
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = task_templates.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role <> ALL (ARRAY['guest'::text, 'client'::text]))))));

create policy "task_templates_update_owner_or_admin" on public.task_templates
  as permissive
  for update
  to authenticated
  using (((created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = task_templates.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text])))))))
  with check (((created_by = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = task_templates.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text])))))));

create policy "task_types_select_active_members" on public.task_types
  as permissive
  for select
  to authenticated
  using (is_active_workspace_member(workspace_id));

create policy "task_types_write_admins" on public.task_types
  as permissive
  for all
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = task_types.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))
  with check ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = task_types.workspace_id) AND (wm.user_id = ( SELECT auth.uid() AS uid)) AND (wm.status = 'active'::text) AND (wm.role = ANY (ARRAY['owner'::text, 'admin'::text]))))));

create policy "task_watchers_delete_self" on public.task_watchers
  as permissive
  for delete
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)));

create policy "task_watchers_insert_self" on public.task_watchers
  as permissive
  for insert
  to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND is_task_visible_to(task_id)));

create policy "task_watchers_select_visible" on public.task_watchers
  as permissive
  for select
  to authenticated
  using ((is_task_visible_to(task_id) AND (NOT is_task_client(task_id))));

create policy "task_watchers_update_self" on public.task_watchers
  as permissive
  for update
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "tasks_insert_active_members" on public.tasks
  as permissive
  for insert
  to authenticated
  with check (is_project_workspace_writer(project_id));

create policy "tasks_select_active_members" on public.tasks
  as permissive
  for select
  to authenticated
  using (((deleted_at IS NULL) AND is_project_visible_to(project_id) AND ((NOT is_project_client(project_id)) OR (client_visible AND is_project_portal_enabled(project_id)))));

create policy "tasks_select_trash_visible_members" on public.tasks
  as permissive
  for select
  to authenticated
  using (((deleted_at IS NOT NULL) AND is_project_visible_to(project_id) AND (NOT is_project_client(project_id))));

create policy "tasks_update_active_members" on public.tasks
  as permissive
  for update
  to authenticated
  using (((deleted_at IS NULL) AND is_project_workspace_writer(project_id)))
  with check (is_project_workspace_writer(project_id));

create policy "time_entries_insert_active_members" on public.time_entries
  as permissive
  for insert
  to authenticated
  with check (is_task_workspace_writer(task_id));

create policy "time_entries_select_active_members" on public.time_entries
  as permissive
  for select
  to authenticated
  using ((is_task_visible_to(task_id) AND (NOT is_task_client(task_id))));

create policy "time_off_entries_delete_own_or_admin" on public.time_off_entries
  as permissive
  for delete
  to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR is_workspace_admin(workspace_id)));

create policy "time_off_entries_insert_own" on public.time_off_entries
  as permissive
  for insert
  to authenticated
  with check (((user_id = ( SELECT auth.uid() AS uid)) AND is_active_workspace_member(workspace_id)));

create policy "time_off_entries_select_active_members" on public.time_off_entries
  as permissive
  for select
  to authenticated
  using (is_active_workspace_member(workspace_id));

create policy "time_off_entries_update_own_or_admin" on public.time_off_entries
  as permissive
  for update
  to authenticated
  using (((user_id = ( SELECT auth.uid() AS uid)) OR is_workspace_admin(workspace_id)))
  with check (((user_id = ( SELECT auth.uid() AS uid)) OR is_workspace_admin(workspace_id)));

create policy "view_tasks_delete_owner" on public.view_tasks
  as permissive
  for delete
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM saved_views sv
  WHERE ((sv.id = view_tasks.view_id) AND (sv.owner_id = ( SELECT auth.uid() AS uid))))));

create policy "view_tasks_insert_owner" on public.view_tasks
  as permissive
  for insert
  to authenticated
  with check ((EXISTS ( SELECT 1
   FROM saved_views sv
  WHERE ((sv.id = view_tasks.view_id) AND (sv.owner_id = ( SELECT auth.uid() AS uid))))));

create policy "view_tasks_select_visible" on public.view_tasks
  as permissive
  for select
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM saved_views sv
  WHERE ((sv.id = view_tasks.view_id) AND ((sv.owner_id = ( SELECT auth.uid() AS uid)) OR ((sv.scope = 'shared'::text) AND (((sv.project_id IS NOT NULL) AND is_project_visible_to(sv.project_id)) OR ((sv.project_id IS NULL) AND is_active_workspace_member(sv.workspace_id)))))))));

create policy "view_tasks_update_owner" on public.view_tasks
  as permissive
  for update
  to authenticated
  using ((EXISTS ( SELECT 1
   FROM saved_views sv
  WHERE ((sv.id = view_tasks.view_id) AND (sv.owner_id = ( SELECT auth.uid() AS uid))))))
  with check ((EXISTS ( SELECT 1
   FROM saved_views sv
  WHERE ((sv.id = view_tasks.view_id) AND (sv.owner_id = ( SELECT auth.uid() AS uid))))));

create policy "workspace_members_select_fellow_members" on public.workspace_members
  as permissive
  for select
  to authenticated
  using ((is_active_workspace_member(workspace_id) AND ((NOT is_workspace_client(workspace_id)) OR (user_id = ( SELECT auth.uid() AS uid)))));

create policy "workspace_members_update_own_status_note" on public.workspace_members
  as permissive
  for update
  to authenticated
  using ((user_id = ( SELECT auth.uid() AS uid)))
  with check ((user_id = ( SELECT auth.uid() AS uid)));

create policy "workspace_slug_history_select_authenticated" on public.workspace_slug_history
  as permissive
  for select
  to authenticated
  using (true);

create policy "workspaces_delete_admins" on public.workspaces
  as permissive
  for delete
  to authenticated
  using (is_workspace_admin(id));

create policy "workspaces_select_active_members" on public.workspaces
  as permissive
  for select
  to authenticated
  using (((deleted_at IS NULL) AND is_active_workspace_member(id)));

create policy "workspaces_update_admins" on public.workspaces
  as permissive
  for update
  to authenticated
  using (((deleted_at IS NULL) AND is_workspace_admin(id)))
  with check (is_workspace_admin(id));


-- ========================= realtime publication ========================

alter publication supabase_realtime add table public._realtime_capability_probe;
alter publication supabase_realtime add table public.channel_members;
alter publication supabase_realtime add table public.channels;
alter publication supabase_realtime add table public.client_requests;
alter publication supabase_realtime add table public.comment_reactions;
alter publication supabase_realtime add table public.comments;
alter publication supabase_realtime add table public.message_reactions;
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.project_statuses;
alter publication supabase_realtime add table public.task_assignees;
alter publication supabase_realtime add table public.tasks;

-- ============================ replica identity =========================

alter table public._realtime_capability_probe replica identity full;
alter table public.comment_reactions replica identity full;
alter table public.message_reactions replica identity full;
alter table public.project_statuses replica identity full;
