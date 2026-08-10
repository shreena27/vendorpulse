import { describe, it, expect } from "vitest";
import { isAllowedCertificateFile } from "./validateCertificateFile";

describe("isAllowedCertificateFile", () => {
  it("accepts a PDF (matching extension and MIME type)", () => {
    expect(
      isAllowedCertificateFile({ name: "insurance.pdf", type: "application/pdf" }),
    ).toEqual({ ok: true });
  });

  it("accepts a JPEG (matching extension and MIME type)", () => {
    expect(
      isAllowedCertificateFile({ name: "insurance.jpg", type: "image/jpeg" }),
    ).toEqual({ ok: true });
    expect(
      isAllowedCertificateFile({ name: "insurance.jpeg", type: "image/jpeg" }),
    ).toEqual({ ok: true });
  });

  it("accepts a PNG (matching extension and MIME type)", () => {
    expect(
      isAllowedCertificateFile({ name: "insurance.png", type: "image/png" }),
    ).toEqual({ ok: true });
  });

  it("rejects a .exe file (disallowed extension and MIME)", () => {
    const result = isAllowedCertificateFile({
      name: "virus.exe",
      type: "application/x-msdownload",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/not allowed|pdf|image/i);
  });

  it("rejects a disallowed MIME type even with an allowed-looking extension", () => {
    const result = isAllowedCertificateFile({
      name: "insurance.pdf",
      type: "application/x-msdownload",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a disallowed extension even with an allowed-looking MIME type (spoofed Content-Type)", () => {
    const result = isAllowedCertificateFile({
      name: "virus.exe",
      type: "application/pdf",
    });
    expect(result.ok).toBe(false);
  });

  it("rejects a mismatched extension/MIME pair (e.g. .jpg claiming application/pdf)", () => {
    const result = isAllowedCertificateFile({
      name: "insurance.jpg",
      type: "application/pdf",
    });
    expect(result.ok).toBe(false);
  });

  it("is case-insensitive on the extension", () => {
    expect(
      isAllowedCertificateFile({ name: "INSURANCE.PDF", type: "application/pdf" }),
    ).toEqual({ ok: true });
  });
});
