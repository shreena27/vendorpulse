import { describe, it, expect, vi } from "vitest";
import { getCertificateSignedUrl } from "./certificateUrl";

describe("getCertificateSignedUrl", () => {
  it("requests a 60-second signed URL for the given path and returns it", async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://signed.example/cert.pdf" }, error: null });
    const client = { storage: { from: () => ({ createSignedUrl }) } };

    const url = await getCertificateSignedUrl(client, "org-1/vendor-1/1_insurance.pdf");

    expect(url).toBe("https://signed.example/cert.pdf");
    expect(createSignedUrl).toHaveBeenCalledWith("org-1/vendor-1/1_insurance.pdf", 60);
  });

  it("throws when Storage returns an error", async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "object not found" } });
    const client = { storage: { from: () => ({ createSignedUrl }) } };

    await expect(getCertificateSignedUrl(client, "missing/path")).rejects.toThrow(
      /object not found/,
    );
  });
});
