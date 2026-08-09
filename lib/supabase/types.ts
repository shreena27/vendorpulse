/**
 * Database types for the Supabase client.
 *
 * Hand-written for Chunk 0.2 (organizations, users). Regenerate with the
 * Supabase CLI once it is linked:
 *   npx supabase gen types typescript --project-id <ref> > lib/supabase/types.ts
 */

export type Role = "admin" | "finance_head" | "ops_lead";

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string; created_at: string };
        Insert: { id?: string; name: string; created_at?: string };
        Update: { id?: string; name?: string; created_at?: string };
        Relationships: [];
      };
      users: {
        Row: {
          id: string;
          organization_id: string;
          role: Role;
          full_name: string | null;
          email: string | null;
          created_at: string;
        };
        Insert: {
          id: string;
          organization_id: string;
          role?: Role;
          full_name?: string | null;
          email?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          role?: Role;
          full_name?: string | null;
          email?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "users_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<never, never>;
    Functions: {
      current_org_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
