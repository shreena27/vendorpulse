import { describe, it, expect, vi } from "vitest";
import { uploadCertificate } from "./uploadCertificate";

function stubClient(overrides?: {
  uploadError?: { message: string } | null;
  rpcError?: { message: string } | null;
}) {
  const upload = vi.fn().mockResolvedValue({
    data: { path: "stub" },
    error: overrides?.uploadError ?? null,
  });
  const remove = vi.fn().mockResolvedValue({ data: null, error: null });
  const rpc = vi.fn().mockResolvedValue({
    data: "cert-1",
    error: overrides?.rpcError ?? null,
  });

  return {
    storage: { from: () => ({ upload, remove }) },
    rpc,
    _mocks: { upload, remove, rpc },
  };
}

const baseInput = {
  vendorId: "vendor-1",
  organizationId: "org-1",
  file: new Blob(["pdf bytes"]),
  fileName: "insurance.pdf",
  mimeType: "application/pdf",
  certificateType: "Insurance",
  expiryDate: "2030-01-01",
};

describe("uploadCertificate", () => {
  it("rejects a disallowed file type before any Storage call", async () => {
    const client = stubClient();

    await expect(
      uploadCertificate(client, { ...baseInput, fileName: "virus.exe", mimeType: "application/x-msdownload" }),
    ).rejects.toThrow(/not allowed|pdf|image/i);

    expect(client._mocks.upload).not.toHaveBeenCalled();
    expect(client._mocks.rpc).not.toHaveBeenCalled();
  });

  it("uploads to a path scoped by org/vendor and records the certificate with status 'valid' for a future expiry", async () => {
    const client = stubClient();

    const summary = await uploadCertificate(client, baseInput);

    expect(client._mocks.upload).toHaveBeenCalledTimes(1);
    const [path] = client._mocks.upload.mock.calls[0];
    expect(path).toMatch(/^org-1\/vendor-1\/\d+_insurance\.pdf$/);

    expect(client._mocks.rpc).toHaveBeenCalledWith("create_certificate", {
      p_vendor_id: "vendor-1",
      p_certificate_type: "Insurance",
      p_file_path: path,
      p_expiry_date: "2030-01-01",
      p_status: "valid",
    });

    expect(summary).toEqual({
      id: "cert-1",
      certificateType: "Insurance",
      expiryDate: "2030-01-01",
      status: "valid",
      filePath: path,
    });
  });

  it("records status 'expired' for a past expiry date", async () => {
    const client = stubClient();

    await uploadCertificate(client, { ...baseInput, expiryDate: "2020-01-01" });

    const [, params] = client._mocks.rpc.mock.calls[0];
    expect(params.p_status).toBe("expired");
  });

  it("throws without calling the RPC when the Storage upload itself fails", async () => {
    const client = stubClient({ uploadError: { message: "storage down" } });

    await expect(uploadCertificate(client, baseInput)).rejects.toThrow(/storage down/);
    expect(client._mocks.rpc).not.toHaveBeenCalled();
  });

  it("deletes the just-uploaded object and re-throws when the RPC fails (no orphan)", async () => {
    const client = stubClient({ rpcError: { message: "vendor not found" } });

    await expect(uploadCertificate(client, baseInput)).rejects.toThrow(/vendor not found/);

    expect(client._mocks.remove).toHaveBeenCalledTimes(1);
    const [removedPaths] = client._mocks.remove.mock.calls[0];
    const [uploadedPath] = client._mocks.upload.mock.calls[0];
    expect(removedPaths).toEqual([uploadedPath]);
  });
});
