import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAllowedCertificateFile } from "@/lib/certificates/validateCertificateFile";
import { listVendorCertificatesWithUrls } from "@/lib/certificates/queries";
import { uploadCertificate } from "@/lib/storage/uploadCertificate";

const EXPIRY_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

async function loadVendor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
) {
  // RLS-scoped: a vendor in another org reads as not found, same as GET /api/vendors/:id.
  const { data: vendor } = await supabase
    .from("vendors")
    .select("id, name, organization_id")
    .eq("id", id)
    .maybeSingle();
  return vendor;
}

// POST /api/vendors/:id/certificates — upload a certificate to Storage and
// record it (ERD §4). Any org user. File-type validation runs before any
// Storage write (uploadCertificate re-checks it too, as defense-in-depth).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected a multipart form upload." },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file was uploaded." }, { status: 400 });
  }

  const certificateType = (form.get("certificateType") as string | null)?.trim();
  if (!certificateType) {
    return NextResponse.json(
      { error: "Certificate type is required." },
      { status: 400 },
    );
  }

  const expiryDate = (form.get("expiryDate") as string | null)?.trim();
  if (!expiryDate || !EXPIRY_DATE_REGEX.test(expiryDate)) {
    return NextResponse.json(
      { error: "A valid expiry date (YYYY-MM-DD) is required." },
      { status: 400 },
    );
  }

  const fileCheck = isAllowedCertificateFile({ name: file.name, type: file.type });
  if (!fileCheck.ok) {
    return NextResponse.json({ error: fileCheck.reason }, { status: 400 });
  }

  const vendor = await loadVendor(supabase, id);
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  try {
    const summary = await uploadCertificate(supabase, {
      vendorId: vendor.id,
      organizationId: vendor.organization_id,
      file: await file.arrayBuffer(),
      fileName: file.name,
      mimeType: file.type,
      certificateType,
      expiryDate,
    });
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Certificate upload failed." },
      { status: 500 },
    );
  }
}

// GET /api/vendors/:id/certificates — list this vendor's certificates with
// fresh, short-lived signed URLs. Any org user.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const vendor = await loadVendor(supabase, id);
  if (!vendor) {
    return NextResponse.json({ error: "Vendor not found." }, { status: 404 });
  }

  const certificates = await listVendorCertificatesWithUrls(supabase, vendor.id);
  return NextResponse.json({ certificates });
}
