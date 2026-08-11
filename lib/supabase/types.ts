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
export type BankStatus = "verified" | "manual_review" | "mismatch" | "unverified";
export type BankNameMatchResult = "exact" | "partial" | "none";
// Distinct from BankStatus: bank_verifications.status never persists
// 'unverified' (that value only exists as the vendor's un-checked default).
export type BankVerificationStatus = "verified" | "manual_review" | "mismatch";
export type BankProvider = "eko" | "mock";
export type CertificateStatus = "valid" | "expired";
export type PaymentStatus = "pending" | "paid" | "cancelled";
export type PaymentMethod = "rtgs" | "neft" | "other";
export type AlertTriggerType = "gst_change" | "msme_change" | "lei_check";
export type AlertStatus = "open" | "hold" | "reviewed" | "cleared" | "escalated";
export type EvidenceEventType =
  | "verification_check"
  | "status_change"
  | "alert_created"
  | "alert_updated"
  | "alert_resolved";
export type LeiCheckStatus = "issued" | "lapsed" | "retired" | "not_on_record";
export type LeiProvider = "gleif";
export type ProductEventType =
  | "vendor_import_completed"
  | "status_change_detected"
  | "alert_created_tracked"
  | "alert_actioned"
  | "bank_cert_issue_caught"
  | "evidence_export_completed"
  | "audit_time_saved_reported"
  | "pilot_to_paid_intent_signal"
  | "pmf_survey_triggered"
  | "pmf_survey_response";
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

export type CheckType = "gst" | "msme_udyam";
// Providers actually built or planned in the Implementation Plan: Sandbox by
// Quicko (GST, live), Deepvue (MSME, stubbed for now), and the mock. The ERD
// §3.2 also names masters_india as an alternative GST provider, but nothing
// builds it — add it back (here and in the CHECK constraint) only if it lands.
export type CheckProvider = "sandbox_quicko" | "deepvue" | "mock";

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
          lei_number: string | null;
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
          lei_number?: string | null;
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
          lei_number?: string | null;
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
      verification_checks: {
        Row: {
          id: string;
          organization_id: string;
          vendor_id: string;
          check_type: CheckType;
          status_value: string;
          provider: CheckProvider;
          raw_response: unknown | null;
          is_change: boolean;
          checked_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          vendor_id: string;
          check_type: CheckType;
          status_value: string;
          provider: CheckProvider;
          raw_response?: unknown | null;
          is_change?: boolean;
          checked_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          vendor_id?: string;
          check_type?: CheckType;
          status_value?: string;
          provider?: CheckProvider;
          raw_response?: unknown | null;
          is_change?: boolean;
          checked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "verification_checks_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "verification_checks_vendor_id_fkey";
            columns: ["vendor_id"];
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      bank_verifications: {
        Row: {
          id: string;
          organization_id: string;
          vendor_id: string;
          account_number_masked: string;
          ifsc: string;
          name_match_result: BankNameMatchResult;
          status: BankVerificationStatus;
          provider: BankProvider;
          re_verified_reason: string | null;
          checked_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          vendor_id: string;
          account_number_masked: string;
          ifsc: string;
          name_match_result: BankNameMatchResult;
          status: BankVerificationStatus;
          provider: BankProvider;
          re_verified_reason?: string | null;
          checked_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          vendor_id?: string;
          account_number_masked?: string;
          ifsc?: string;
          name_match_result?: BankNameMatchResult;
          status?: BankVerificationStatus;
          provider?: BankProvider;
          re_verified_reason?: string | null;
          checked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "bank_verifications_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bank_verifications_vendor_id_fkey";
            columns: ["vendor_id"];
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      certificates: {
        Row: {
          id: string;
          organization_id: string;
          vendor_id: string;
          certificate_type: string;
          file_path: string;
          expiry_date: string;
          status: CertificateStatus;
          uploaded_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          vendor_id: string;
          certificate_type: string;
          file_path: string;
          expiry_date: string;
          status: CertificateStatus;
          uploaded_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          vendor_id?: string;
          certificate_type?: string;
          file_path?: string;
          expiry_date?: string;
          status?: CertificateStatus;
          uploaded_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "certificates_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "certificates_vendor_id_fkey";
            columns: ["vendor_id"];
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          organization_id: string;
          vendor_id: string;
          amount: string;
          due_date: string;
          payment_method: PaymentMethod;
          status: PaymentStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          vendor_id: string;
          amount: string;
          due_date: string;
          payment_method: PaymentMethod;
          status?: PaymentStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          vendor_id?: string;
          amount?: string;
          due_date?: string;
          payment_method?: PaymentMethod;
          status?: PaymentStatus;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_vendor_id_fkey";
            columns: ["vendor_id"];
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      alerts: {
        Row: {
          id: string;
          organization_id: string;
          vendor_id: string;
          trigger_type: AlertTriggerType;
          // No FK: points into verification_checks (or, later, lei_checks)
          // depending on trigger_type — same polymorphic-reference pattern
          // as evidence_log.
          source_check_id: string;
          payment_impact_amount: string;
          status: AlertStatus;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          vendor_id: string;
          trigger_type: AlertTriggerType;
          source_check_id: string;
          payment_impact_amount?: string;
          status?: AlertStatus;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          vendor_id?: string;
          trigger_type?: AlertTriggerType;
          source_check_id?: string;
          payment_impact_amount?: string;
          status?: AlertStatus;
          resolved_by?: string | null;
          resolved_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alerts_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_vendor_id_fkey";
            columns: ["vendor_id"];
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "alerts_resolved_by_fkey";
            columns: ["resolved_by"];
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      evidence_log: {
        Row: {
          id: string;
          organization_id: string;
          vendor_id: string;
          event_type: EvidenceEventType;
          entity_type: string;
          entity_id: string;
          payload: unknown;
          actor: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          vendor_id: string;
          event_type: EvidenceEventType;
          entity_type: string;
          entity_id: string;
          payload?: unknown;
          actor?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          vendor_id?: string;
          event_type?: EvidenceEventType;
          entity_type?: string;
          entity_id?: string;
          payload?: unknown;
          actor?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "evidence_log_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "evidence_log_vendor_id_fkey";
            columns: ["vendor_id"];
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
        ];
      };
      lei_checks: {
        Row: {
          id: string;
          organization_id: string;
          vendor_id: string;
          payment_id: string;
          lei_number: string | null;
          status: LeiCheckStatus;
          provider: LeiProvider;
          raw_response: unknown;
          checked_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          vendor_id: string;
          payment_id: string;
          lei_number?: string | null;
          status: LeiCheckStatus;
          provider?: LeiProvider;
          raw_response?: unknown;
          checked_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          vendor_id?: string;
          payment_id?: string;
          lei_number?: string | null;
          status?: LeiCheckStatus;
          provider?: LeiProvider;
          raw_response?: unknown;
          checked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lei_checks_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lei_checks_vendor_id_fkey";
            columns: ["vendor_id"];
            referencedRelation: "vendors";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lei_checks_payment_id_fkey";
            columns: ["payment_id"];
            referencedRelation: "payments";
            referencedColumns: ["id"];
          },
        ];
      };
      product_events: {
        Row: {
          id: string;
          organization_id: string;
          vendor_id: string | null;
          event_type: ProductEventType;
          payload: unknown;
          actor: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          vendor_id?: string | null;
          event_type: ProductEventType;
          payload?: unknown;
          actor?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          vendor_id?: string | null;
          event_type?: ProductEventType;
          payload?: unknown;
          actor?: string;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_events_organization_id_fkey";
            columns: ["organization_id"];
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_events_vendor_id_fkey";
            columns: ["vendor_id"];
            referencedRelation: "vendors";
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
      record_bank_verification: {
        Args: {
          p_vendor_id: string;
          p_account_number_masked: string;
          p_ifsc: string;
          p_name_match_result: BankNameMatchResult;
          p_status: BankVerificationStatus;
          p_provider: BankProvider;
          p_re_verified_reason?: string | null;
        };
        Returns: string;
      };
      create_certificate: {
        Args: {
          p_vendor_id: string;
          p_certificate_type: string;
          p_file_path: string;
          p_expiry_date: string;
          p_status: CertificateStatus;
        };
        Returns: string;
      };
      resolve_alert: {
        Args: {
          p_alert_id: string;
          p_action: string;
        };
        Returns: {
          id: string;
          organization_id: string;
          vendor_id: string;
          trigger_type: AlertTriggerType;
          source_check_id: string;
          payment_impact_amount: string;
          status: AlertStatus;
          resolved_by: string | null;
          resolved_at: string | null;
          created_at: string;
        };
      };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};
