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
  public: {
    Tables: {
      announcement_audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          announcement_id: string | null
          changes: Json
          created_at: string
          id: string
          summary: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          announcement_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          summary?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          announcement_id?: string | null
          changes?: Json
          created_at?: string
          id?: string
          summary?: string | null
        }
        Relationships: []
      }
      announcements: {
        Row: {
          body: string
          created_by: string | null
          id: string
          published_at: string
          scheduled_for: string | null
          status: string
          title: string
        }
        Insert: {
          body: string
          created_by?: string | null
          id?: string
          published_at?: string
          scheduled_for?: string | null
          status?: string
          title: string
        }
        Update: {
          body?: string
          created_by?: string | null
          id?: string
          published_at?: string
          scheduled_for?: string | null
          status?: string
          title?: string
        }
        Relationships: []
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      mcp_call_logs: {
        Row: {
          category: string | null
          created_at: string
          error_message: string | null
          id: string
          instance_id: string | null
          latency_ms: number | null
          status: string
          tool_name: string | null
          upstream: boolean
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          instance_id?: string | null
          latency_ms?: number | null
          status: string
          tool_name?: string | null
          upstream?: boolean
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          instance_id?: string | null
          latency_ms?: number | null
          status?: string
          tool_name?: string | null
          upstream?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcp_call_logs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "n8n_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      n8n_instances: {
        Row: {
          api_key_encrypted: string
          api_key_iv: string
          api_key_tag: string
          base_url: string
          created_at: string
          id: string
          last_checked_at: string | null
          name: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          api_key_encrypted: string
          api_key_iv: string
          api_key_tag: string
          base_url: string
          created_at?: string
          id?: string
          last_checked_at?: string | null
          name: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          api_key_encrypted?: string
          api_key_iv?: string
          api_key_tag?: string
          base_url?: string
          created_at?: string
          id?: string
          last_checked_at?: string | null
          name?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_api_keys: {
        Row: {
          created_at: string
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          theme_preference: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          theme_preference?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          theme_preference?: string
          updated_at?: string
        }
        Relationships: []
      }
      prompt_usage_daily: {
        Row: {
          day: string
          prompts: number
          user_id: string
        }
        Insert: {
          day: string
          prompts?: number
          user_id: string
        }
        Update: {
          day?: string
          prompts?: number
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          billing_customer_id: string | null
          billing_provider: string
          billing_subscription_id: string | null
          created_at: string
          current_period_end: string | null
          status: string
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          billing_customer_id?: string | null
          billing_provider?: string
          billing_subscription_id?: string | null
          created_at?: string
          current_period_end?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          billing_customer_id?: string | null
          billing_provider?: string
          billing_subscription_id?: string | null
          created_at?: string
          current_period_end?: string | null
          status?: string
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      usage_daily: {
        Row: {
          day: string
          mcp_calls: number
          user_id: string
        }
        Insert: {
          day: string
          mcp_calls?: number
          user_id: string
        }
        Update: {
          day?: string
          mcp_calls?: number
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_today_mcp_usage: { Args: { _user_id: string }; Returns: number }
      get_today_prompt_usage: { Args: { _user_id: string }; Returns: number }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_mcp_usage: {
        Args: { _n?: number; _user_id: string }
        Returns: undefined
      }
      increment_prompt_usage: {
        Args: { _n?: number; _user_id: string }
        Returns: undefined
      }
      publish_due_announcements: { Args: never; Returns: number }
    }
    Enums: {
      app_role: "admin" | "user"
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
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
