/**
 * Signed-URL helper for the private `certificates` bucket (Chunk 2.2).
 * SERVER-ONLY. Must be called with the caller's authenticated client so the
 * storage.objects SELECT policy (migration 0005) actually applies — using
 * the admin client would bypass it.
 */

const SIGNED_URL_TTL_SECONDS = 60;

export interface SignedUrlClient {
  storage: {
    from(bucket: "certificates"): {
      createSignedUrl(
        path: string,
        expiresInSeconds: number,
      ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
}

export async function getCertificateSignedUrl(
  supabase: SignedUrlClient,
  filePath: string,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from("certificates")
    .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
  if (error || !data) {
    throw new Error(`could not create signed URL: ${error?.message ?? "unknown error"}`);
  }
  return data.signedUrl;
}
