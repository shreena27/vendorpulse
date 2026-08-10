/**
 * Pure certificate file-type validation (Chunk 2.2). Runs before any Storage
 * write, so a disallowed file never touches Storage. Checks the declared
 * extension AND the declared MIME type, and requires them to agree on the
 * same file kind — belt-and-suspenders, mirrors the account-number/IFSC dual
 * checks in Chunk 2.1 (lib/import/validateVendorRow.ts).
 */

export type CertificateFileCheck = { ok: true } | { ok: false; reason: string };

// extension (lowercase, no dot) -> the one MIME type it must be declared as.
const ALLOWED: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

export function isAllowedCertificateFile(file: {
  name: string;
  type: string;
}): CertificateFileCheck {
  const match = /\.([a-zA-Z0-9]+)$/.exec(file.name);
  const extension = match?.[1]?.toLowerCase();

  if (!extension || !(extension in ALLOWED)) {
    return {
      ok: false,
      reason: "Only PDF, JPEG, or PNG files are allowed.",
    };
  }
  if (file.type !== ALLOWED[extension]) {
    return {
      ok: false,
      reason: `File type "${file.type}" does not match a ".${extension}" file. Only PDF, JPEG, or PNG files are allowed.`,
    };
  }
  return { ok: true };
}
