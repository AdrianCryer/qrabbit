// The schema in apps/cloud/supabase/migrations, as supabase-js wants it. Kept by hand so it reads well; after a
// schema change, `pnpm cloud:types` writes the CLI's own (unformatted) version next to the stack for a diff.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      blobs: {
        Row: {
          user_id: string;
          sha256: string;
          size: number;
          state: string;
          refs: number;
          created_at: string;
          unreferenced_at: string | null;
        };
        Insert: {
          user_id: string;
          sha256: string;
          size: number;
          state?: string;
          refs?: number;
          created_at?: string;
          unreferenced_at?: string | null;
        };
        Update: {
          user_id?: string;
          sha256?: string;
          size?: number;
          state?: string;
          refs?: number;
          created_at?: string;
          unreferenced_at?: string | null;
        };
        Relationships: [];
      };
      collections: {
        Row: {
          user_id: string;
          id: string;
          name: string;
          rev: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id?: string;
          id: string;
          name: string;
          rev?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          id?: string;
          name?: string;
          rev?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      devices: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          platform: string;
          created_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
          name: string;
          platform: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          platform?: string;
          created_at?: string;
          last_seen_at?: string;
        };
        Relationships: [];
      };
      files: {
        Row: {
          user_id: string;
          collection_id: string;
          path: string;
          sha256: string | null;
          size: number;
          deleted: boolean;
          rev: number;
          device_id: string | null;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          collection_id: string;
          path: string;
          sha256?: string | null;
          size?: number;
          deleted?: boolean;
          rev: number;
          device_id?: string | null;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          collection_id?: string;
          path?: string;
          sha256?: string | null;
          size?: number;
          deleted?: boolean;
          rev?: number;
          device_id?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string | null;
          plan: string;
          quota_bytes: number;
          created_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          plan?: string;
          quota_bytes?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          plan?: string;
          quota_bytes?: number;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      blob_stored: { Args: { p_user: string; p_sha: string }; Returns: boolean };
      blob_usage: { Args: { p_user: string }; Returns: number };
      commit_changes: { Args: { p_collection: string; p_base: number; p_changes: Json; p_device?: string }; Returns: Json };
      file_entry: { Args: { f: Database["public"]["Tables"]["files"]["Row"] }; Returns: Json };
      gc_finish_blobs: { Args: { p_items: Json }; Returns: number };
      gc_mark_blobs: { Args: { p_grace?: string; p_limit?: number }; Returns: { user_id: string; sha256: string }[] };
      is_valid_sync_path: { Args: { p: string }; Returns: boolean };
      list_changes: { Args: { p_collection: string; p_since?: number; p_cursor_rev?: number; p_cursor_path?: string; p_limit?: number }; Returns: Json };
      me: { Args: Record<PropertyKey, never>; Returns: Json };
      reserve_blobs: { Args: { p_items: Json }; Returns: Json };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
