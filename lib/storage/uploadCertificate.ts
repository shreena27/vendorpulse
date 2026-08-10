/**
 * Certificate upload orchestrator (Chunk 2.2). SERVER-ONLY.
 *
 * The single call site for "upload one certificate": validate the file type
 * (before any Storage write), upload to the private `certificates` bucket at
 * a path scoped by org/vendor, derive valid/expired from the expiry date,
 * then record the row via the create_certificate() RPC. If the RPC fails
 * after a successful upload, the just-uploaded object is deleted — a failed
 * request never leaves an orphaned file in Storage.
 *
 * Must be called with the CALLER'S authenticated Supabase client, not the
 * admin/service-role client — the storage.objects RLS policies (migration
 * 0005) are what actually enforce org isolation on the bucket, and using the
 * admin client would silently bypass them.
 */

import { isAllowedCertificateFile } from "@/lib/certificates/validateCertificateFile";
import { deriveCertificateStatus, type CertificateStatus } from "@/lib/certificates/certificateStatus";

export interface UploadCertificateInput {
  vendorId: string;
  organizationId: string;
  file: Blob | ArrayBuffer;
  fileName: string;
  mimeType: string;
  certificateType: string;
  /** YYYY-MM-DD */
  expiryDate: string;
}

export interface UploadCertificateSummary {
  id: string;
  certificateType: string;
  expiryDate: string;
  status: CertificateStatus;
  filePath: string;
}

/** Minimal Supabase client surface this function needs — easy to stub in tests. */
export interface CertificateStorageClient {
  storage: {
    from(bucket: "certificates"): {
      upload(
        path: string,
        file: Blob | ArrayBuffer,
        options?: { contentType?: string },
      ): Promise<{ data: { path: string } | null; error: { message: string } | null }>;
      remove(paths: string[]): Promise<{ data: unknown; error: { message: string } | null }>;
    };
  };
  rpc(
    fn: "create_certificate",
    params: {
      p_vendor_id: string;
      p_certificate_type: string;
      p_file_path: string;
      p_expiry_date: string;
      p_status: CertificateStatus;
    },
  ): PromiseLike<{ data?: unknown; error: { message: string } | null }>;
}

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function uploadCertificate(
  supabase: CertificateStorageClient,
  input: UploadCertificateInput,
): Promise<UploadCertificateSummary> {
  const check = isAllowedCertificateFile({ name: input.fileName, type: input.mimeType });
  if (!check.ok) {
    throw new Error(check.reason);
  }

  const path = `${input.organizationId}/${input.vendorId}/${Date.now()}_${safeFileName(input.fileName)}`;
  const bucket = supabase.storage.from("certificates");

  const { error: uploadError } = await bucket.upload(path, input.file, {
    contentType: input.mimeType,
  });
  if (uploadError) {
    throw new Error(`certificate upload failed: ${uploadError.message}`);
  }

  const status = deriveCertificateStatus(input.expiryDate, new Date());

  const { data, error: rpcError } = await supabase.rpc("create_certificate", {
    p_vendor_id: input.vendorId,
    p_certificate_type: input.certificateType,
    p_file_path: path,
    p_expiry_date: input.expiryDate,
    p_status: status,
  });
  if (rpcError) {
    await bucket.remove([path]);
    throw new Error(`create certificate failed: ${rpcError.message}`);
  }

  return {
    id: data as string,
    certificateType: input.certificateType,
    expiryDate: input.expiryDate,
    status,
    filePath: path,
  };
}
