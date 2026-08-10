import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { uploadCertificate } from "./uploadCertificate";
import { getCertificateSignedUrl } from "./certificateUrl";

// Load .env.local into process.env (the Vitest runner is a separate process).
try {
  const envPath = fileURLToPath(new URL("../../.env.local", import.meta.url));
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  }
} catch {
  // No .env.local — the suite self-skips below.
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && ANON && SERVICE);

const TEST_PDF = new TextEncoder().encode("%PDF-1.4 integration test content").buffer;

/**
 * Chunk 2.2 acceptance (integration): a certificate upload writes exactly one
 * row + one Storage object, a signed URL can be read back, a DB-side failure
 * leaves no orphaned object, and — the requirement this test exists to prove
 * — the storage.objects RLS policy itself (not just the app's vendor-org
 * check) blocks a different org's caller from reading or writing the first
 * org's folder.
 *
 * Prerequisite: migration 0005 applied and Supabase "Confirm email" off.
 */
describe.skipIf(!hasEnv)("uploadCertificate (integration)", () => {
  let admin: SupabaseClient<Database>;
  let clientA: SupabaseClient<Database>;
  let clientB: SupabaseClient<Database>;
  let orgA: string;
  let orgB: string;
  let userIdA: string;
  let userIdB: string;
  let vendorIdA: string;

  async function signUpOrg(tag: string): Promise<{
    client: SupabaseClient<Database>;
    userId: string;
    orgId: string;
  }> {
    const client = createClient<Database>(SUPABASE_URL!, ANON!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const email = `vendorpulse.cert.${tag}.${Date.now()}.${Math.random()
      .toString(36)
      .slice(2, 8)}@gmail.com`;
    const { data, error } = await client.auth.signUp({
      email,
      password: "test-password-123",
    });
    expect(error, error?.message).toBeNull();
    const userId = data.user!.id;

    const { data: userRow } = await admin
      .from("users")
      .select("organization_id")
      .eq("id", userId)
      .single();
    return { client, userId, orgId: userRow!.organization_id };
  }

  beforeAll(async () => {
    admin = createClient<Database>(SUPABASE_URL!, SERVICE!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const a = await signUpOrg("a");
    clientA = a.client;
    userIdA = a.userId;
    orgA = a.orgId;

    const b = await signUpOrg("b");
    clientB = b.client;
    userIdB = b.userId;
    orgB = b.orgId;

    const { data: vendor, error } = await admin
      .from("vendors")
      .insert({ organization_id: orgA, name: "Cert Integration Vendor", source: "excel" })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();
    vendorIdA = vendor!.id;
  });

  afterAll(async () => {
    if (!admin) return;
    for (const orgId of [orgA, orgB]) {
      if (!orgId) continue;
      await admin.from("vendors").delete().eq("organization_id", orgId);
      await admin.from("organizations").delete().eq("id", orgId);
    }
    if (userIdA) await admin.auth.admin.deleteUser(userIdA);
    if (userIdB) await admin.auth.admin.deleteUser(userIdB);
  });

  it("uploads a certificate, records it, and produces a working signed URL", async () => {
    const summary = await uploadCertificate(clientA, {
      vendorId: vendorIdA,
      organizationId: orgA,
      file: TEST_PDF,
      fileName: "insurance.pdf",
      mimeType: "application/pdf",
      certificateType: "Insurance",
      expiryDate: "2030-01-01",
    });

    expect(summary.status).toBe("valid");
    expect(summary.filePath).toMatch(new RegExp(`^${orgA}/${vendorIdA}/`));

    const { data: row, error } = await admin
      .from("certificates")
      .select("*")
      .eq("id", summary.id)
      .single();
    expect(error, error?.message).toBeNull();
    expect(row!.file_path).toBe(summary.filePath);
    expect(row!.status).toBe("valid");

    const url = await getCertificateSignedUrl(clientA, summary.filePath);
    expect(url).toMatch(/^https?:\/\//);
    const res = await fetch(url);
    expect(res.status).toBe(200);
  });

  it("marks a past expiry date as expired immediately", async () => {
    const summary = await uploadCertificate(clientA, {
      vendorId: vendorIdA,
      organizationId: orgA,
      file: TEST_PDF,
      fileName: "expired.pdf",
      mimeType: "application/pdf",
      certificateType: "Safety Certificate",
      expiryDate: "2020-01-01",
    });
    expect(summary.status).toBe("expired");
  });

  it("leaves no orphaned Storage object when the RPC fails after a successful upload", async () => {
    const bogusVendorId = "00000000-0000-0000-0000-000000000000";

    await expect(
      uploadCertificate(clientA, {
        vendorId: bogusVendorId,
        organizationId: orgA,
        file: TEST_PDF,
        fileName: "orphan-check.pdf",
        mimeType: "application/pdf",
        certificateType: "Insurance",
        expiryDate: "2030-01-01",
      }),
    ).rejects.toThrow();

    const { data: listing, error } = await admin.storage
      .from("certificates")
      .list(`${orgA}/${bogusVendorId}`);
    expect(error, error?.message).toBeNull();
    expect(listing ?? []).toHaveLength(0);
  });

  it("blocks a different org's caller from reading the first org's certificate via a signed URL", async () => {
    const summary = await uploadCertificate(clientA, {
      vendorId: vendorIdA,
      organizationId: orgA,
      file: TEST_PDF,
      fileName: "cross-org-read.pdf",
      mimeType: "application/pdf",
      certificateType: "Insurance",
      expiryDate: "2030-01-01",
    });

    await expect(getCertificateSignedUrl(clientB, summary.filePath)).rejects.toThrow();
  });

  it("blocks a different org's caller from writing into the first org's folder — storage.objects RLS, not just the app's vendor check", async () => {
    // Org B's client, but a path forced under org A's folder (simulating a
    // hypothetical app-code bug that mixed up the organizationId). The
    // storage.objects INSERT policy must reject this on its own, independent
    // of anything the app validated.
    await expect(
      uploadCertificate(clientB, {
        vendorId: vendorIdA,
        organizationId: orgA,
        file: TEST_PDF,
        fileName: "cross-org-write.pdf",
        mimeType: "application/pdf",
        certificateType: "Insurance",
        expiryDate: "2030-01-01",
      }),
    ).rejects.toThrow(/upload failed/);
  });
});
