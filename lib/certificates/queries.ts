/**
 * Shared, RLS-scoped read for a vendor's certificates (Chunk 2.2). Used by
 * both the GET route and the server-component page, so the two never drift
 * (same pattern as lib/vendors/queries.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, CertificateStatus } from "@/lib/supabase/types";
import { getCertificateSignedUrl } from "@/lib/storage/certificateUrl";

type Client = SupabaseClient<Database>;

export interface CertificateSummary {
  id: string;
  certificateType: string;
  filePath: string;
  expiryDate: string;
  status: CertificateStatus;
  uploadedAt: string;
}

export interface CertificateWithUrl extends CertificateSummary {
  /** Null if the signed URL couldn't be generated (e.g. object missing). */
  url: string | null;
}

export async function listVendorCertificates(
  supabase: Client,
  vendorId: string,
): Promise<CertificateSummary[]> {
  const { data, error } = await supabase
    .from("certificates")
    .select("id, certificate_type, file_path, expiry_date, status, uploaded_at")
    .eq("vendor_id", vendorId)
    .order("uploaded_at", { ascending: false });
  if (error) throw new Error(`list certificates failed: ${error.message}`);

  return (data ?? []).map((c) => ({
    id: c.id,
    certificateType: c.certificate_type,
    filePath: c.file_path,
    expiryDate: c.expiry_date,
    status: c.status,
    uploadedAt: c.uploaded_at,
  }));
}

/**
 * Same list, each row carrying a fresh 60-second signed URL. Shared by the
 * GET route and the certificates page, so they never drift. A row whose
 * signed URL can't be generated still appears (url: null) rather than
 * disappearing from the list.
 */
export async function listVendorCertificatesWithUrls(
  supabase: Client,
  vendorId: string,
): Promise<CertificateWithUrl[]> {
  const certificates = await listVendorCertificates(supabase, vendorId);
  return Promise.all(
    certificates.map(async (c) => ({
      ...c,
      url: await getCertificateSignedUrl(supabase, c.filePath).catch(() => null),
    })),
  );
}
