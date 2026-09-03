export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      active_timers: {
        Row: {
          id: string
          started_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          id?: string
          started_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          id?: string
          started_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_timers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "active_timers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          artifact_snapshot_path: string | null
          artifact_url: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          decision_type: string
          description: string | null
          due_at: string | null
          id: string
          phase_id: string | null
          project_id: string
          requested_at: string
          requested_by: string
          resulting_task_id: string | null
          round: number
          state: string
          subject_id: string | null
          subject_type: string
          supersedes_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          artifact_snapshot_path?: string | null
          artifact_url?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          decision_type: string
          description?: string | null
          due_at?: string | null
          id?: string
          phase_id?: string | null
          project_id: string
          requested_at?: string
          requested_by: string
          resulting_task_id?: string | null
          round?: number
          state?: string
          subject_id?: string | null
          subject_type: string
          supersedes_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          artifact_snapshot_path?: string | null
          artifact_url?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          decision_type?: string
          description?: string | null
          due_at?: string | null
          id?: string
          phase_id?: string | null
          project_id?: string
          requested_at?: string
          requested_by?: string
          resulting_task_id?: string | null
          round?: number
          state?: string
          subject_id?: string | null
          subject_type?: string
          supersedes_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "project_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_resulting_task_id_fkey"
            columns: ["resulting_task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_resulting_task_id_fkey"
            columns: ["resulting_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          created_at: string
          file_name: string
          file_url: string
          id: string
          mime_type: string | null
          task_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          file_name: string
          file_url: string
          id?: string
          mime_type?: string | null
          task_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          file_name?: string
          file_url?: string
          id?: string
          mime_type?: string | null
          task_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          metadata: Json
          target_id: string | null
          target_type: string
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string | null
          target_type: string
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          metadata?: Json
          target_id?: string | null
          target_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      board_swimlane_prefs: {
        Row: {
          collapsed_lanes: Json
          created_at: string
          group_by: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          collapsed_lanes?: Json
          created_at?: string
          group_by?: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          collapsed_lanes?: Json
          created_at?: string
          group_by?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_swimlane_prefs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_members: {
        Row: {
          channel_id: string
          joined_at: string
          last_read_at: string
          user_id: string
        }
        Insert: {
          channel_id: string
          joined_at?: string
          last_read_at?: string
          user_id: string
        }
        Update: {
          channel_id?: string
          joined_at?: string
          last_read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_members_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          created_at: string
          created_by: string
          id: string
          kind: string
          name: string | null
          project_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          kind: string
          name?: string | null
          project_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          name?: string | null
          project_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channels_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          checked_at: string | null
          checked_by: string | null
          content: string
          created_at: string
          id: string
          is_checked: boolean
          position: number
          task_id: string
        }
        Insert: {
          checked_at?: string | null
          checked_by?: string | null
          content: string
          created_at?: string
          id?: string
          is_checked?: boolean
          position?: number
          task_id: string
        }
        Update: {
          checked_at?: string | null
          checked_by?: string | null
          content?: string
          created_at?: string
          id?: string
          is_checked?: boolean
          position?: number
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      client_deliverables: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          blocking: boolean
          created_at: string
          delivered_at: string | null
          description: string | null
          due_at: string | null
          id: string
          kind: string
          owner_name: string
          phase_id: string | null
          position: number
          project_id: string
          review_note: string | null
          state: string
          task_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          blocking?: boolean
          created_at?: string
          delivered_at?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          kind: string
          owner_name: string
          phase_id?: string | null
          position?: number
          project_id: string
          review_note?: string | null
          state?: string
          task_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          blocking?: boolean
          created_at?: string
          delivered_at?: string | null
          description?: string | null
          due_at?: string | null
          id?: string
          kind?: string
          owner_name?: string
          phase_id?: string | null
          position?: number
          project_id?: string
          review_note?: string | null
          state?: string
          task_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_deliverables_phase_id_fkey"
            columns: ["phase_id", "project_id"]
            isOneToOne: false
            referencedRelation: "project_phases"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "client_deliverables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_deliverables_task_id_fkey"
            columns: ["task_id", "project_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id", "project_id"]
          },
          {
            foreignKeyName: "client_deliverables_task_id_fkey"
            columns: ["task_id", "project_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "project_id"]
          },
        ]
      }
      client_requests: {
        Row: {
          approval_request_id: string | null
          body: string | null
          client_decision: string
          converted_task_id: string | null
          created_at: string
          created_by: string
          decided_at: string | null
          decided_by: string | null
          decline_reason: string | null
          desired_by: string | null
          id: string
          kind: string
          project_id: string
          quote_currency: string | null
          quote_note: string | null
          quote_valid_until: string | null
          quoted_amount: number | null
          quoted_hours: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          scope_verdict: string | null
          severity: string | null
          status: string
          title: string
          track: string | null
          track_overridden: boolean
          track_override_reason: string | null
          updated_at: string
        }
        Insert: {
          approval_request_id?: string | null
          body?: string | null
          client_decision?: string
          converted_task_id?: string | null
          created_at?: string
          created_by: string
          decided_at?: string | null
          decided_by?: string | null
          decline_reason?: string | null
          desired_by?: string | null
          id?: string
          kind?: string
          project_id: string
          quote_currency?: string | null
          quote_note?: string | null
          quote_valid_until?: string | null
          quoted_amount?: number | null
          quoted_hours?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_verdict?: string | null
          severity?: string | null
          status?: string
          title: string
          track?: string | null
          track_overridden?: boolean
          track_override_reason?: string | null
          updated_at?: string
        }
        Update: {
          approval_request_id?: string | null
          body?: string | null
          client_decision?: string
          converted_task_id?: string | null
          created_at?: string
          created_by?: string
          decided_at?: string | null
          decided_by?: string | null
          decline_reason?: string | null
          desired_by?: string | null
          id?: string
          kind?: string
          project_id?: string
          quote_currency?: string | null
          quote_note?: string | null
          quote_valid_until?: string | null
          quoted_amount?: number | null
          quoted_hours?: number | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          scope_verdict?: string | null
          severity?: string | null
          status?: string
          title?: string
          track?: string | null
          track_overridden?: boolean
          track_override_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_requests_approval_request_id_fkey"
            columns: ["approval_request_id"]
            isOneToOne: false
            referencedRelation: "approval_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_converted_task_id_fkey"
            columns: ["converted_task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_converted_task_id_fkey"
            columns: ["converted_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_requests_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          emoji: string
          task_id: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          emoji: string
          task_id: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          emoji?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_reactions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_reactions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          body_json: Json | null
          body_text: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          edited_at: string | null
          id: string
          internal: boolean
          task_id: string
          text: string
          user_id: string
        }
        Insert: {
          body_json?: Json | null
          body_text?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: string
          internal?: boolean
          task_id: string
          text: string
          user_id: string
        }
        Update: {
          body_json?: Json | null
          body_text?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          edited_at?: string | null
          id?: string
          internal?: boolean
          task_id?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      doc_folders: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          parent_id: string | null
          position: number
          project_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name: string
          parent_id?: string | null
          position?: number
          project_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          parent_id?: string | null
          position?: number
          project_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "doc_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "doc_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_folders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "doc_folders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      docs: {
        Row: {
          content: string
          created_at: string
          created_by: string
          folder_id: string | null
          id: string
          position: number
          project_id: string | null
          title: string
          updated_at: string
          updated_by: string | null
          workspace_id: string
        }
        Insert: {
          content?: string
          created_at?: string
          created_by: string
          folder_id?: string | null
          id?: string
          position?: number
          project_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string
          folder_id?: string | null
          id?: string
          position?: number
          project_id?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "docs_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "doc_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "docs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attachments: {
        Row: {
          channel_id: string
          created_at: string
          file_name: string
          file_size: number | null
          id: string
          message_id: string | null
          mime_type: string | null
          storage_path: string
          uploaded_by: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          file_name: string
          file_size?: number | null
          id?: string
          message_id?: string | null
          mime_type?: string | null
          storage_path: string
          uploaded_by: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          file_name?: string
          file_size?: number | null
          id?: string
          message_id?: string | null
          mime_type?: string | null
          storage_path?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attachments_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          channel_id: string
          created_at: string
          emoji: string
          message_id: string
          user_id: string
        }
        Insert: {
          channel_id: string
          created_at?: string
          emoji: string
          message_id: string
          user_id: string
        }
        Update: {
          channel_id?: string
          created_at?: string
          emoji?: string
          message_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body_json: Json
          body_text: string
          channel_id: string
          created_at: string
          deleted_at: string | null
          edited_at: string | null
          id: string
          parent_message_id: string | null
          sender_id: string
        }
        Insert: {
          body_json: Json
          body_text?: string
          channel_id: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_message_id?: string | null
          sender_id: string
        }
        Update: {
          body_json?: Json
          body_text?: string
          channel_id?: string
          created_at?: string
          deleted_at?: string | null
          edited_at?: string | null
          id?: string
          parent_message_id?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_parent_message_id_fkey"
            columns: ["parent_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          comment_reply_email: boolean
          comment_reply_in_app: boolean
          created_at: string
          email_enabled: boolean
          mention_email: boolean
          mention_in_app: boolean
          task_assigned_email: boolean
          task_assigned_in_app: boolean
          task_due_soon_email: boolean
          task_due_soon_in_app: boolean
          updated_at: string
          user_id: string
          watcher_update_email: boolean
          watcher_update_in_app: boolean
        }
        Insert: {
          comment_reply_email?: boolean
          comment_reply_in_app?: boolean
          created_at?: string
          email_enabled?: boolean
          mention_email?: boolean
          mention_in_app?: boolean
          task_assigned_email?: boolean
          task_assigned_in_app?: boolean
          task_due_soon_email?: boolean
          task_due_soon_in_app?: boolean
          updated_at?: string
          user_id: string
          watcher_update_email?: boolean
          watcher_update_in_app?: boolean
        }
        Update: {
          comment_reply_email?: boolean
          comment_reply_in_app?: boolean
          created_at?: string
          email_enabled?: boolean
          mention_email?: boolean
          mention_in_app?: boolean
          task_assigned_email?: boolean
          task_assigned_in_app?: boolean
          task_due_soon_email?: boolean
          task_due_soon_in_app?: boolean
          updated_at?: string
          user_id?: string
          watcher_update_email?: boolean
          watcher_update_in_app?: boolean
        }
        Relationships: []
      }
      notifications: {
        Row: {
          actor_id: string | null
          comment_id: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          read_at: string | null
          task_id: string | null
          user_id: string
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          comment_id?: string | null
          created_at?: string
          id?: string
          kind: string
          payload?: Json
          read_at?: string | null
          task_id?: string | null
          user_id: string
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          comment_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          payload?: Json
          read_at?: string | null
          task_id?: string | null
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      personal_todos: {
        Row: {
          created_at: string
          id: string
          is_done: boolean
          position: number
          title: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_done?: boolean
          position?: number
          title: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_done?: boolean
          position?: number
          title?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "personal_todos_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          color: string | null
          created_at: string
          display_name: string | null
          id: string
          timezone: string
          tour_completed_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          color?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          timezone?: string
          tour_completed_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          color?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          timezone?: string
          tour_completed_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      project_assumptions: {
        Row: {
          client_visible: boolean
          confirmed_by_name: string | null
          confirmed_on: string | null
          created_at: string
          flagged_by_client_at: string | null
          flagged_note: string | null
          id: string
          project_id: string
          state: string
          text: string
          updated_at: string
        }
        Insert: {
          client_visible?: boolean
          confirmed_by_name?: string | null
          confirmed_on?: string | null
          created_at?: string
          flagged_by_client_at?: string | null
          flagged_note?: string | null
          id?: string
          project_id: string
          state?: string
          text: string
          updated_at?: string
        }
        Update: {
          client_visible?: boolean
          confirmed_by_name?: string | null
          confirmed_on?: string | null
          created_at?: string
          flagged_by_client_at?: string | null
          flagged_note?: string | null
          id?: string
          project_id?: string
          state?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_assumptions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_decision_owners: {
        Row: {
          created_at: string
          decision_type: string
          id: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          decision_type: string
          id?: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          decision_type?: string
          id?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_decision_owners_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_decisions: {
        Row: {
          client_visible: boolean
          created_at: string
          created_by: string
          decided_by_name: string | null
          decided_on: string
          decision_type: string
          id: string
          phase_id: string | null
          project_id: string
          rationale: string | null
          title: string
        }
        Insert: {
          client_visible?: boolean
          created_at?: string
          created_by: string
          decided_by_name?: string | null
          decided_on?: string
          decision_type: string
          id?: string
          phase_id?: string | null
          project_id: string
          rationale?: string | null
          title: string
        }
        Update: {
          client_visible?: boolean
          created_at?: string
          created_by?: string
          decided_by_name?: string | null
          decided_on?: string
          decision_type?: string
          id?: string
          phase_id?: string | null
          project_id?: string
          rationale?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_decisions_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "project_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_decisions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_favorites: {
        Row: {
          created_at: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_favorites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_members: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          project_id: string
          project_role: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          project_id: string
          project_role?: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          project_id?: string
          project_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_phases: {
        Row: {
          actual_end: string | null
          actual_start: string | null
          client_description: string | null
          client_visible: boolean
          created_at: string
          id: string
          name: string
          planned_end: string | null
          planned_start: string | null
          position: number
          project_id: string
          state: string
          updated_at: string
        }
        Insert: {
          actual_end?: string | null
          actual_start?: string | null
          client_description?: string | null
          client_visible?: boolean
          created_at?: string
          id?: string
          name: string
          planned_end?: string | null
          planned_start?: string | null
          position?: number
          project_id: string
          state?: string
          updated_at?: string
        }
        Update: {
          actual_end?: string | null
          actual_start?: string | null
          client_description?: string | null
          client_visible?: boolean
          created_at?: string
          id?: string
          name?: string
          planned_end?: string | null
          planned_start?: string | null
          position?: number
          project_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_phases_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_scope_items: {
        Row: {
          change_request_id: string | null
          created_at: string
          description: string | null
          id: string
          included: boolean
          position: number
          project_id: string
          source: string
          title: string
        }
        Insert: {
          change_request_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          included: boolean
          position?: number
          project_id: string
          source: string
          title: string
        }
        Update: {
          change_request_id?: string | null
          created_at?: string
          description?: string | null
          id?: string
          included?: boolean
          position?: number
          project_id?: string
          source?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_scope_items_change_request_id_fkey"
            columns: ["change_request_id"]
            isOneToOne: false
            referencedRelation: "client_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_scope_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_statuses: {
        Row: {
          category: string
          client_bucket: string | null
          client_description: string | null
          color: string
          created_at: string
          id: string
          name: string
          position: number
          project_id: string
        }
        Insert: {
          category: string
          client_bucket?: string | null
          client_description?: string | null
          color: string
          created_at?: string
          id?: string
          name: string
          position?: number
          project_id: string
        }
        Update: {
          category?: string
          client_bucket?: string | null
          client_description?: string | null
          color?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_statuses_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          archived_by: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          end_date: string | null
          id: string
          key: string
          launch_confidence: string | null
          launch_note: string | null
          name: string
          portal_enabled: boolean
          portal_enabled_at: string | null
          start_date: string | null
          target_launch_date: string | null
          task_counter: number
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          key?: string
          launch_confidence?: string | null
          launch_note?: string | null
          name: string
          portal_enabled?: boolean
          portal_enabled_at?: string | null
          start_date?: string | null
          target_launch_date?: string | null
          task_counter?: number
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          archived_by?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          key?: string
          launch_confidence?: string | null
          launch_note?: string | null
          name?: string
          portal_enabled?: boolean
          portal_enabled_at?: string | null
          start_date?: string | null
          target_launch_date?: string | null
          task_counter?: number
          updated_at?: string
          visibility?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          config: Json
          created_at: string
          id: string
          is_default: boolean
          name: string
          owner_id: string
          position: number
          project_id: string | null
          scope: string
          updated_at: string
          view_type: string
          workspace_id: string
        }
        Insert: {
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name: string
          owner_id: string
          position?: number
          project_id?: string | null
          scope?: string
          updated_at?: string
          view_type?: string
          workspace_id: string
        }
        Update: {
          config?: Json
          created_at?: string
          id?: string
          is_default?: boolean
          name?: string
          owner_id?: string
          position?: number
          project_id?: string | null
          scope?: string
          updated_at?: string
          view_type?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_views_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      status_template_items: {
        Row: {
          category: string
          color: string
          id: string
          name: string
          position: number
          template_id: string
        }
        Insert: {
          category: string
          color: string
          id?: string
          name: string
          position?: number
          template_id: string
        }
        Update: {
          category?: string
          color?: string
          id?: string
          name?: string
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "status_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      status_templates: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_activity: {
        Row: {
          actor_id: string | null
          created_at: string
          field: string | null
          id: string
          kind: string
          new_value: Json | null
          old_value: Json | null
          task_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          field?: string | null
          id?: string
          kind: string
          new_value?: Json | null
          old_value?: Json | null
          task_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          field?: string | null
          id?: string
          kind?: string
          new_value?: Json | null
          old_value?: Json | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_activity_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_assignees: {
        Row: {
          assigned_by: string | null
          created_at: string
          task_id: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          task_id: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_assignees_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_dependencies: {
        Row: {
          blocked_task_id: string
          blocking_task_id: string
          created_at: string
          created_by: string
          id: string
        }
        Insert: {
          blocked_task_id: string
          blocking_task_id: string
          created_at?: string
          created_by: string
          id?: string
        }
        Update: {
          blocked_task_id?: string
          blocking_task_id?: string
          created_at?: string
          created_by?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_dependencies_blocked_task_id_fkey"
            columns: ["blocked_task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_blocked_task_id_fkey"
            columns: ["blocked_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_blocking_task_id_fkey"
            columns: ["blocking_task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_dependencies_blocking_task_id_fkey"
            columns: ["blocking_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_templates: {
        Row: {
          created_at: string
          created_by: string
          id: string
          kind: string
          name: string
          payload: Json
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          kind?: string
          name: string
          payload: Json
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          kind?: string
          name?: string
          payload?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_templates_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_types: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          position: number
          system_key: string | null
          workspace_id: string
        }
        Insert: {
          color: string
          created_at?: string
          id?: string
          name: string
          position?: number
          system_key?: string | null
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          position?: number
          system_key?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_types_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      task_watchers: {
        Row: {
          created_at: string
          is_watching: boolean
          task_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_watching?: boolean
          task_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_watching?: boolean
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_watchers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_watchers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_id: string | null
          author_id: string
          client_visible: boolean
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_via_task_id: string | null
          description: string | null
          description_json: Json | null
          description_text: string | null
          due_date: string | null
          estimate_minutes: number | null
          id: string
          last_occurrence_at: string | null
          number: number
          page_order: number | null
          page_slug: string | null
          parent_task_id: string | null
          pending_client_approval: boolean
          phase_id: string | null
          points: number | null
          position: number
          priority: string | null
          project_id: string
          recurrence: Json | null
          recurrence_parent_id: string | null
          search_vector: unknown
          start_date: string | null
          status: string
          status_id: string | null
          tags: string[]
          task_type_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          author_id: string
          client_visible?: boolean
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_via_task_id?: string | null
          description?: string | null
          description_json?: Json | null
          description_text?: string | null
          due_date?: string | null
          estimate_minutes?: number | null
          id?: string
          last_occurrence_at?: string | null
          number?: number
          page_order?: number | null
          page_slug?: string | null
          parent_task_id?: string | null
          pending_client_approval?: boolean
          phase_id?: string | null
          points?: number | null
          position?: number
          priority?: string | null
          project_id: string
          recurrence?: Json | null
          recurrence_parent_id?: string | null
          search_vector?: unknown
          start_date?: string | null
          status?: string
          status_id?: string | null
          tags?: string[]
          task_type_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          author_id?: string
          client_visible?: boolean
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          deleted_via_task_id?: string | null
          description?: string | null
          description_json?: Json | null
          description_text?: string | null
          due_date?: string | null
          estimate_minutes?: number | null
          id?: string
          last_occurrence_at?: string | null
          number?: number
          page_order?: number | null
          page_slug?: string | null
          parent_task_id?: string | null
          pending_client_approval?: boolean
          phase_id?: string | null
          points?: number | null
          position?: number
          priority?: string | null
          project_id?: string
          recurrence?: Json | null
          recurrence_parent_id?: string | null
          search_vector?: unknown
          start_date?: string | null
          status?: string
          status_id?: string | null
          tags?: string[]
          task_type_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_deleted_via_task_id_fkey"
            columns: ["deleted_via_task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deleted_via_task_id_fkey"
            columns: ["deleted_via_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_phase_id_fkey"
            columns: ["phase_id"]
            isOneToOne: false
            referencedRelation: "project_phases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "project_statuses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_task_type_id_fkey"
            columns: ["task_type_id"]
            isOneToOne: false
            referencedRelation: "task_types"
            referencedColumns: ["id"]
          },
        ]
      }
      time_entries: {
        Row: {
          billable: boolean
          created_at: string
          entry_date: string
          id: string
          minutes: number
          note: string | null
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          billable?: boolean
          created_at?: string
          entry_date?: string
          id?: string
          minutes: number
          note?: string | null
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          billable?: boolean
          created_at?: string
          entry_date?: string
          id?: string
          minutes?: number
          note?: string | null
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          invited_email: string | null
          invited_project_id: string | null
          portal_last_seen_at: string | null
          role: string
          status: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_email?: string | null
          invited_project_id?: string | null
          portal_last_seen_at?: string | null
          role?: string
          status?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_email?: string | null
          invited_project_id?: string | null
          portal_last_seen_at?: string | null
          role?: string
          status?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_invited_project_id_fkey"
            columns: ["invited_project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_slug_history: {
        Row: {
          created_at: string
          id: string
          old_slug: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          old_slug: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          old_slug?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_slug_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          logo_url: string | null
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          logo_url?: string | null
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
      }
    }
    Views: {
      active_project_tasks: {
        Row: {
          assignee_id: string | null
          author_id: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          deleted_via_task_id: string | null
          description: string | null
          description_json: Json | null
          description_text: string | null
          due_date: string | null
          estimate_minutes: number | null
          id: string | null
          last_occurrence_at: string | null
          number: number | null
          parent_task_id: string | null
          points: number | null
          position: number | null
          priority: string | null
          project_id: string | null
          project_workspace_id: string | null
          recurrence: Json | null
          recurrence_parent_id: string | null
          search_vector: unknown
          start_date: string | null
          status: string | null
          status_id: string | null
          tags: string[] | null
          title: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "projects_workspace_id_fkey"
            columns: ["project_workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deleted_via_task_id_fkey"
            columns: ["deleted_via_task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deleted_via_task_id_fkey"
            columns: ["deleted_via_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "active_project_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_recurrence_parent_id_fkey"
            columns: ["recurrence_parent_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_status_id_fkey"
            columns: ["status_id"]
            isOneToOne: false
            referencedRelation: "project_statuses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_client_request_atomic: {
        Args: { p_request_id: string }
        Returns: {
          task_id: string
        }[]
      }
      accept_deliverable_atomic: {
        Args: { p_decision: string; p_deliverable_id: string; p_note?: string }
        Returns: {
          deliverable_id: string
          state: string
        }[]
      }
      apply_status_template: {
        Args: { p_project_id: string; p_template_id: string }
        Returns: undefined
      }
      approve_portal_task_atomic: {
        Args: { p_task_id: string }
        Returns: {
          task_id: string
        }[]
      }
      assert_portal_task_actionable_by_client: {
        Args: { p_task_id: string }
        Returns: {
          project_id: string
          task_id: string
        }[]
      }
      bulk_delete_tasks_atomic: {
        Args: {
          p_deleted_at: string
          p_deleted_by: string
          p_task_ids: string[]
        }
        Returns: string[]
      }
      can_modify_comment: {
        Args: { target_comment_id: string }
        Returns: boolean
      }
      can_read_workspace_docs: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      can_write_workspace_docs: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      cascade_delete_task:
        | {
            Args: { p_task_id: string }
            Returns: {
              deleted_at: string
              id: string
            }[]
          }
        | {
            Args: { p_deleted_by?: string; p_task_id: string }
            Returns: {
              deleted_at: string
              id: string
            }[]
          }
      change_workspace_slug_atomic: {
        Args: { p_new_slug: string; p_old_slug: string; p_workspace_id: string }
        Returns: {
          slug: string
        }[]
      }
      client_gate: {
        Args: {
          p_client_visible?: boolean
          p_project_id: string
          p_require_client_role?: boolean
          p_require_portal_enabled?: boolean
          p_require_project_visible?: boolean
        }
        Returns: boolean
      }
      create_channel_atomic: {
        Args: {
          p_created_by: string
          p_kind: string
          p_member_ids: string[]
          p_name?: string
          p_project_id?: string
          p_workspace_id: string
        }
        Returns: string
      }
      create_notification: {
        Args: {
          p_actor_id?: string
          p_comment_id?: string
          p_kind: string
          p_payload?: Json
          p_system?: boolean
          p_task_id?: string
          p_user_id: string
          p_workspace_id: string
        }
        Returns: {
          actor_id: string | null
          comment_id: string | null
          created_at: string
          id: string
          kind: string
          payload: Json
          read_at: string | null
          task_id: string | null
          user_id: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "notifications"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_project_from_template: {
        Args: {
          p_created_by: string
          p_deliverables?: Json
          p_description: string
          p_name: string
          p_phases?: Json
          p_tasks: Json
          p_workspace_id: string
        }
        Returns: {
          project_id: string
          project_key: string
          project_name: string
        }[]
      }
      create_workspace_with_owner: {
        Args: { p_name: string; p_slug: string }
        Returns: {
          id: string
          slug: string
        }[]
      }
      decide_approval_atomic: {
        Args: { p_decision: string; p_note?: string; p_request_id: string }
        Returns: {
          decided_at: string
          request_id: string
          resulting_task_id: string
          state: string
        }[]
      }
      derive_project_key_base: { Args: { p_name: string }; Returns: string }
      duplicate_task_atomic: {
        Args: { p_new_task_id: string; p_source_task_id: string }
        Returns: undefined
      }
      flag_assumption_atomic: {
        Args: { p_assumption_id: string; p_note: string }
        Returns: {
          assumption_id: string
          flagged_by_client_at: string
        }[]
      }
      generate_due_recurring_occurrences: { Args: never; Returns: number }
      generate_unique_project_key: {
        Args: { p_name: string; p_workspace_id: string }
        Returns: string
      }
      get_blocked_count: { Args: { p_workspace_id: string }; Returns: number }
      get_chat_channel_summaries: {
        Args: { p_channel_ids: string[] }
        Returns: {
          channel_id: string
          last_message_at: string
          unread_count: number
        }[]
      }
      get_completed_count: {
        Args: { p_days?: number; p_timezone?: string; p_workspace_id: string }
        Returns: number
      }
      get_dependency_ancestors: {
        Args: { p_task_id: string }
        Returns: {
          task_id: string
        }[]
      }
      get_dependency_descendants: {
        Args: { p_task_id: string }
        Returns: {
          task_id: string
        }[]
      }
      get_due_soon_count: {
        Args: { p_days?: number; p_timezone?: string; p_workspace_id: string }
        Returns: number
      }
      get_open_task_counts: {
        Args: { project_ids: string[] }
        Returns: {
          open_count: number
          project_id: string
        }[]
      }
      get_overdue_count: {
        Args: { p_timezone?: string; p_workspace_id: string }
        Returns: number
      }
      get_priority_counts: {
        Args: { p_workspace_id: string }
        Returns: {
          count: number
          priority: string
        }[]
      }
      get_project_board_tasks: {
        Args: { p_project_id: string }
        Returns: {
          assignee_id: string
          assignee_ids: string[]
          checklist_done: number
          checklist_total: number
          child_done: number
          child_total: number
          due_date: string
          estimate_minutes: number
          id: string
          number: number
          open_blocker_count: number
          position: number
          priority: string
          project_key: string
          recurrence: Json
          status: string
          status_category: string
          subtask_count: number
          tags: string[]
          title: string
          updated_at: string
        }[]
      }
      get_project_time_totals: {
        Args: { p_project_id: string }
        Returns: {
          billable_minutes: number
          estimate_minutes: number
          non_billable_minutes: number
        }[]
      }
      get_status_counts: {
        Args: { p_workspace_id: string }
        Returns: {
          category: string
          color: string
          count: number
          name: string
        }[]
      }
      get_workspace_time_by_person: {
        Args: {
          p_end_date: string
          p_start_date: string
          p_workspace_id: string
        }
        Returns: {
          billable_minutes: number
          non_billable_minutes: number
          user_id: string
        }[]
      }
      is_active_workspace_member: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      is_done_status: {
        Args: { p_status: string; p_status_id: string }
        Returns: boolean
      }
      is_project_client: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      is_project_decision_owner: {
        Args: {
          p_decision_type: string
          p_project_id: string
          p_user_id: string
        }
        Returns: boolean
      }
      is_project_lead_or_workspace_admin: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      is_project_portal_enabled: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      is_project_visible_to: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      is_project_visible_to_row: {
        Args: {
          target_project_id: string
          target_visibility: string
          target_workspace_id: string
        }
        Returns: boolean
      }
      is_project_workspace_admin: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      is_project_workspace_member: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      is_project_workspace_writer: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      is_task_client: { Args: { target_task_id: string }; Returns: boolean }
      is_task_visible_to: { Args: { target_task_id: string }; Returns: boolean }
      is_task_workspace_member: {
        Args: { target_task_id: string }
        Returns: boolean
      }
      is_task_workspace_writer: {
        Args: { target_task_id: string }
        Returns: boolean
      }
      is_valid_timezone: { Args: { tz: string }; Returns: boolean }
      is_workspace_admin: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      is_workspace_client: {
        Args: { target_workspace_id: string }
        Returns: boolean
      }
      mark_deliverable_delivered_atomic: {
        Args: { p_deliverable_id: string }
        Returns: {
          deliverable_id: string
          state: string
        }[]
      }
      notify_overdue_task_assignees: { Args: never; Returns: number }
      purge_comment: {
        Args: { p_comment_id: string }
        Returns: {
          id: string
        }[]
      }
      purge_task: {
        Args: { p_task_id: string }
        Returns: {
          attachment_paths: string[]
          id: string
        }[]
      }
      reassign_and_delete_project_status: {
        Args: { p_destination_status_id: string; p_source_status_id: string }
        Returns: undefined
      }
      recurrence_next_due_date: {
        Args: { p_from_date: string; p_rule: Json }
        Returns: string
      }
      remove_workspace_member: {
        Args: { p_membership_id: string; p_workspace_id: string }
        Returns: {
          deleted: boolean
          reason: string
        }[]
      }
      request_portal_task_changes_atomic: {
        Args: { p_task_id: string }
        Returns: {
          task_id: string
        }[]
      }
      restore_task_atomic: {
        Args: { p_task_id: string }
        Returns: {
          id: string
          position: number
          project_id: string
          status: string
          status_was_reset: boolean
        }[]
      }
      search_tasks: {
        Args: { p_project_id: string; p_query: string }
        Returns: {
          assignee_id: string | null
          author_id: string
          client_visible: boolean
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          deleted_via_task_id: string | null
          description: string | null
          description_json: Json | null
          description_text: string | null
          due_date: string | null
          estimate_minutes: number | null
          id: string
          last_occurrence_at: string | null
          number: number
          page_order: number | null
          page_slug: string | null
          parent_task_id: string | null
          pending_client_approval: boolean
          phase_id: string | null
          points: number | null
          position: number
          priority: string | null
          project_id: string
          recurrence: Json | null
          recurrence_parent_id: string | null
          search_vector: unknown
          start_date: string | null
          status: string
          status_id: string | null
          tags: string[]
          task_type_id: string | null
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "tasks"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      seed_default_phases: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      seed_default_project_statuses: {
        Args: { target_project_id: string }
        Returns: undefined
      }
      send_change_request_quote_atomic: {
        Args: {
          p_portal_url?: string
          p_quote_currency?: string
          p_quote_note?: string
          p_quote_valid_until?: string
          p_quoted_amount?: number
          p_quoted_hours?: number
          p_request_id: string
          p_scope_verdict: string
          p_severity?: string
          p_track?: string
          p_track_overridden?: boolean
          p_track_override_reason?: string
        }
        Returns: {
          approval_request_id: string
          request_id: string
          scope_verdict: string
        }[]
      }
      set_saved_view_default: {
        Args: { p_view_id: string }
        Returns: undefined
      }
      set_task_assignees_atomic: {
        Args: {
          p_assigned_by: string
          p_desired_user_ids: string[]
          p_task_id: string
        }
        Returns: string
      }
      shares_non_client_workspace_with: {
        Args: { target_user_id: string }
        Returns: boolean
      }
      shares_workspace_with: {
        Args: { target_user_id: string }
        Returns: boolean
      }
      start_timer_atomic: {
        Args: { p_task_id: string }
        Returns: {
          id: string
          started_at: string
          task_id: string
          user_id: string
        }[]
      }
      stop_timer_atomic: {
        Args: never
        Returns: {
          billable: boolean
          created_at: string
          entry_date: string
          id: string
          minutes: number
          note: string
          task_id: string
          user_id: string
        }[]
      }
      sweep_overdue_blocking_deliverables: { Args: never; Returns: number }
      tiptap_doc_from_text: { Args: { p_text: string }; Returns: Json }
      tiptap_text_from_doc: { Args: { p_doc: Json }; Returns: string }
      transfer_workspace_ownership: {
        Args: { p_new_owner_user_id: string; p_workspace_id: string }
        Returns: {
          reason: string
          transferred: boolean
        }[]
      }
      write_audit_log_entry: {
        Args: {
          p_action: string
          p_metadata?: Json
          p_target_id: string
          p_target_type: string
          p_workspace_id: string
        }
        Returns: {
          action: string
          actor_id: string
          created_at: string
          id: string
          metadata: Json
          target_id: string | null
          target_type: string
          workspace_id: string
        }
        SetofOptions: {
          from: "*"
          to: "audit_log"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      write_task_activity_entry: {
        Args: {
          p_field?: string
          p_kind: string
          p_new_value?: Json
          p_old_value?: Json
          p_system?: boolean
          p_task_id: string
        }
        Returns: {
          actor_id: string | null
          created_at: string
          field: string | null
          id: string
          kind: string
          new_value: Json | null
          old_value: Json | null
          task_id: string
        }
        SetofOptions: {
          from: "*"
          to: "task_activity"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
