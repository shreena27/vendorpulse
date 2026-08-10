/**
 * Database types for the Supabase client.
 *
 * Hand-written for Chunk 0.2 (organizations, users). Regenerate with the
 * Supabase CLI once it is linked:
 *   npx supabase gen types typescript --project-id <ref> > lib/supabase/types.ts
 */

export type Role = "admin" | "finance_head" | "ops_lead";

export type GstStatus =
  | "active"
  | "inactive"
  | "cancelled"
  | "not_applicable"
  | "unknown";
export type MsmeStatus = "registered" | "lapsed" | "not_msme" | "unknown";
export type BankStatus = "verified" | "mismatch" | "unverified";
export type VendorSource = "tally" | "excel" | "erp_sync";
export type ImportSource = "tally_export" | "excel" | "erp_sync";
export type ImportStatus =
  | "processing"
  | "completed"
  | "completed_with_errors";

/** One validated vendor as passed to the import_vendors() RPC. */
export type VendorImportInput = {
  name: string;
  gstin: string | null;
  udyam_number: string | null;
  pan: string | null;
  current_gst_status: GstStatus;
  current_msme_status: MsmeStatus;
  current_bank_status: BankStatus;
  source: VendorSource;
};

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
      vendor_imports: {
        Row: {
          id: string;
          organization_id: string;
          source: ImportSource;
          row_count: number;
          error_count: number;
          status: ImportStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          source: ImportSource;
          row_count?: number;
          error_count?: number;
          status?: ImportStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          source?: ImportSource;
          row_count?: number;
          error_count?: number;
          status?: ImportStatus;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendor_imports_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      vendors: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          gstin: string | null;
          udyam_number: string | null;
          pan: string | null;
          current_gst_status: GstStatus;
          current_msme_status: MsmeStatus;
          current_bank_status: BankStatus;
          source: VendorSource | null;
          import_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          gstin?: string | null;
          udyam_number?: string | null;
          pan?: string | null;
          current_gst_status?: GstStatus;
          current_msme_status?: MsmeStatus;
          current_bank_status?: BankStatus;
          source?: VendorSource | null;
          import_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          gstin?: string | null;
          udyam_number?: string | null;
          pan?: string | null;
          current_gst_status?: GstStatus;
          current_msme_status?: MsmeStatus;
          current_bank_status?: BankStatus;
          source?: VendorSource | null;
          import_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vendors_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vendors_import_id_fkey";
            columns: ["import_id"];
            referencedRelation: "vendor_imports";
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
      import_vendors: {
        Args: {
          p_source: ImportSource;
          p_row_count: number;
          p_error_count: number;
          p_vendors: VendorImportInput[];
        };
        Returns: string;
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
