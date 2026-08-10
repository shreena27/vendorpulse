/**
 * Shared, RLS-scoped read logic for the vendor dashboard (Chunk 1.5).
 *
 * Used by both the API routes and the server-component pages, so the two never
 * drift. Every query runs on the caller's authenticated client, so the database
 * enforces org isolation. The list never selects PAN; the detail selects it but
 * only returns it to finance_head / admin (DPDP, ERD §6.3).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Role } from "@/lib/supabase/types";
import { deriveStatusBadge, type Badge } from "./statusBadge";

type Client = SupabaseClient<Database>;

export interface CallerContext {
  userId: string;
  role: Role | null;
  canSeePii: boolean;
}

/** The signed-in caller's role, and whether they may see DPDP fields (PAN). */
export async function getCallerContext(
  supabase: Client,
): Promise<CallerContext | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  const role = (data?.role ?? null) as Role | null;
  return {
    userId: user.id,
    role,
    canSeePii: role === "finance_head" || role === "admin",
  };
}

export interface VendorSummary {
  id: string;
  name: string;
  gstin: string | null;
  udyam_number: string | null;
  gst: Badge;
  msme: Badge;
  bank: Badge;
  changed: boolean;
}

export async function listVendorsWithStatus(
  supabase: Client,
): Promise<VendorSummary[]> {
  const { data: vendors, error } = await supabase
    .from("vendors")
    .select(
      "id, name, gstin, udyam_number, current_gst_status, current_msme_status, current_bank_status",
    )
    .order("name", { ascending: true });
  if (error) throw new Error(`list vendors failed: ${error.message}`);

  const rows = vendors ?? [];
  if (rows.length === 0) return [];

  // One query for all checks; reduce to "has a check" + the latest is_change,
  // per vendor and type.
  const { data: checks, error: cErr } = await supabase
    .from("verification_checks")
    .select("vendor_id, check_type, is_change, checked_at")
    .in(
      "vendor_id",
      rows.map((v) => v.id),
    )
    .order("checked_at", { ascending: false });
  if (cErr) throw new Error(`list checks failed: ${cErr.message}`);

  const hasCheck = new Set<string>();
  const latestChange = new Map<string, boolean>();
  for (const c of checks ?? []) {
    const key = `${c.vendor_id}|${c.check_type}`;
    hasCheck.add(key);
    if (!latestChange.has(key)) latestChange.set(key, c.is_change); // first = latest (desc)
  }

  return rows.map((v) => {
    const changed =
      Boolean(latestChange.get(`${v.id}|gst`)) ||
      Boolean(latestChange.get(`${v.id}|msme_udyam`));
    return {
      id: v.id,
      name: v.name,
      gstin: v.gstin,
      udyam_number: v.udyam_number,
      gst: deriveStatusBadge({
        kind: "gst",
        hasIdentifier: Boolean(v.gstin),
        hasCheck: hasCheck.has(`${v.id}|gst`),
        currentStatus: v.current_gst_status,
      }),
      msme: deriveStatusBadge({
        kind: "msme",
        hasIdentifier: Boolean(v.udyam_number),
        hasCheck: hasCheck.has(`${v.id}|msme_udyam`),
        currentStatus: v.current_msme_status,
      }),
      bank: deriveStatusBadge({
        kind: "bank",
        hasIdentifier: true,
        hasCheck: true,
        currentStatus: v.current_bank_status,
      }),
      changed,
    };
  });
}

export interface VendorDetail {
  id: string;
  name: string;
  gstin: string | null;
  udyam_number: string | null;
  pan: string | null; // null unless the caller may see PII
  canSeePii: boolean;
  gst: Badge;
  msme: Badge;
  bank: Badge;
}

export interface CheckHistoryEntry {
  id: string;
  check_type: "gst" | "msme_udyam";
  status_value: string;
  provider: string;
  is_change: boolean;
  checked_at: string;
}

export async function getVendorDetail(
  supabase: Client,
  id: string,
  canSeePii: boolean,
): Promise<{ vendor: VendorDetail; history: CheckHistoryEntry[] } | null> {
  const { data: v } = await supabase
    .from("vendors")
    .select(
      "id, name, gstin, udyam_number, pan, current_gst_status, current_msme_status, current_bank_status",
    )
    .eq("id", id)
    .maybeSingle();
  // Null = not found or another org's vendor (RLS). Caller returns 404.
  if (!v) return null;

  const { data: history } = await supabase
    .from("verification_checks")
    .select("id, check_type, status_value, provider, is_change, checked_at")
    .eq("vendor_id", id)
    .order("checked_at", { ascending: true }); // chronological

  const hist = (history ?? []) as CheckHistoryEntry[];
  const hasGst = hist.some((h) => h.check_type === "gst");
  const hasMsme = hist.some((h) => h.check_type === "msme_udyam");

  const vendor: VendorDetail = {
    id: v.id,
    name: v.name,
    gstin: v.gstin,
    udyam_number: v.udyam_number,
    // Read but only surfaced to finance_head / admin; dropped for everyone else
    // before it leaves the server.
    pan: canSeePii ? v.pan : null,
    canSeePii,
    gst: deriveStatusBadge({
      kind: "gst",
      hasIdentifier: Boolean(v.gstin),
      hasCheck: hasGst,
      currentStatus: v.current_gst_status,
    }),
    msme: deriveStatusBadge({
      kind: "msme",
      hasIdentifier: Boolean(v.udyam_number),
      hasCheck: hasMsme,
      currentStatus: v.current_msme_status,
    }),
    bank: deriveStatusBadge({
      kind: "bank",
      hasIdentifier: true,
      hasCheck: true,
      currentStatus: v.current_bank_status,
    }),
  };

  return { vendor, history: hist };
}
