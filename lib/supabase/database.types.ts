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
    PostgrestVersion: "14.15"
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
            referencedRelation: "tasks"
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
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          task_id: string
          text: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          task_id: string
          text: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          task_id?: string
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
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
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          color?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          color?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
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
      projects: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          end_date: string | null
          id: string
          key: string
          name: string
          start_date: string | null
          task_counter: number
          updated_at: string
          visibility: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          key?: string
          name: string
          start_date?: string | null
          task_counter?: number
          updated_at?: string
          visibility?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          end_date?: string | null
          id?: string
          key?: string
          name?: string
          start_date?: string | null
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
            referencedRelation: "tasks"
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
      tasks: {
        Row: {
          assignee_id: string | null
          author_id: string
          created_at: string
          deleted_at: string | null
          deleted_via_task_id: string | null
          description: string | null
          due_date: string | null
          id: string
          number: number
          parent_task_id: string | null
          points: number | null
          position: number
          priority: string | null
          project_id: string
          search_vector: unknown
          start_date: string | null
          status: string
          tags: string[]
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          author_id: string
          created_at?: string
          deleted_at?: string | null
          deleted_via_task_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          number?: number
          parent_task_id?: string | null
          points?: number | null
          position?: number
          priority?: string | null
          project_id: string
          search_vector?: unknown
          start_date?: string | null
          status?: string
          tags?: string[]
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          author_id?: string
          created_at?: string
          deleted_at?: string | null
          deleted_via_task_id?: string | null
          description?: string | null
          due_date?: string | null
          id?: string
          number?: number
          parent_task_id?: string | null
          points?: number | null
          position?: number
          priority?: string | null
          project_id?: string
          search_vector?: unknown
          start_date?: string | null
          status?: string
          tags?: string[]
          title?: string
          updated_at?: string
        }
        Relationships: [
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
      [_ in never]: never
    }
    Functions: {
      can_modify_comment: {
        Args: { target_comment_id: string }
        Returns: boolean
      }
      cascade_delete_task: {
        Args: { p_task_id: string }
        Returns: {
          deleted_at: string
          id: string
        }[]
      }
      create_workspace_with_owner: {
        Args: { p_name: string; p_slug: string }
        Returns: {
          id: string
          slug: string
        }[]
      }
      derive_project_key_base: { Args: { p_name: string }; Returns: string }
      generate_unique_project_key: {
        Args: { p_name: string; p_workspace_id: string }
        Returns: string
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
          checklist_done: number
          checklist_total: number
          child_done: number
          child_total: number
          due_date: string
          id: string
          number: number
          open_blocker_count: number
          position: number
          priority: string
          project_key: string
          status: string
          subtask_count: number
          title: string
          updated_at: string
        }[]
      }
      get_project_time_totals: {
        Args: { p_project_id: string }
        Returns: {
          billable_minutes: number
          non_billable_minutes: number
        }[]
      }
      get_status_counts: {
        Args: { p_workspace_id: string }
        Returns: {
          count: number
          status: string
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
      is_project_lead_or_workspace_admin: {
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
      is_project_workspace_member: {
        Args: { target_project_id: string }
        Returns: boolean
      }
      is_project_workspace_writer: {
        Args: { target_project_id: string }
        Returns: boolean
      }
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
      remove_workspace_member: {
        Args: { p_membership_id: string; p_workspace_id: string }
        Returns: {
          deleted: boolean
          reason: string
        }[]
      }
      search_tasks: {
        Args: { p_project_id: string; p_query: string }
        Returns: {
          assignee_id: string | null
          author_id: string
          created_at: string
          deleted_at: string | null
          deleted_via_task_id: string | null
          description: string | null
          due_date: string | null
          id: string
          number: number
          parent_task_id: string | null
          points: number | null
          position: number
          priority: string | null
          project_id: string
          search_vector: unknown
          start_date: string | null
          status: string
          tags: string[]
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
