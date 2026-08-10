import { describe, it, expect } from "vitest";
import {
  detectChange,
  mapGstStatusToVendor,
  mapMsmeStatusToVendor,
  buildCheck,
} from "./changeDetector";

describe("detectChange", () => {
  it("is false for a vendor's first check (no prior)", () => {
    expect(detectChange(null, "ACTIVE")).toBe(false);
  });

  it("is false when the status is unchanged", () => {
    expect(detectChange("ACTIVE", "ACTIVE")).toBe(false);
  });

  it("is true when the status differs from the prior", () => {
    expect(detectChange("ACTIVE", "CANCELLED")).toBe(true);
  });
});

describe("status mappers", () => {
  it("maps GST statuses to the vendor enum", () => {
    expect(mapGstStatusToVendor("ACTIVE")).toBe("active");
    expect(mapGstStatusToVendor("CANCELLED")).toBe("cancelled");
    expect(mapGstStatusToVendor("SUSPENDED")).toBe("inactive");
    expect(mapGstStatusToVendor("INACTIVE")).toBe("inactive");
    expect(mapGstStatusToVendor("UNKNOWN")).toBe("unknown");
    expect(mapGstStatusToVendor("something-else")).toBe("unknown");
  });

  it("maps MSME statuses to the vendor enum", () => {
    expect(mapMsmeStatusToVendor("REGISTERED")).toBe("registered");
    expect(mapMsmeStatusToVendor("LAPSED")).toBe("lapsed");
    expect(mapMsmeStatusToVendor("NOT_MSME")).toBe("not_msme");
    expect(mapMsmeStatusToVendor("UNKNOWN")).toBe("unknown");
    expect(mapMsmeStatusToVendor("weird")).toBe("unknown");
  });
});

describe("buildCheck", () => {
  const vendor = { id: "v1", organization_id: "org1" };
  const now = "2026-08-10T00:00:00.000Z";

  it("assembles a verification_checks row and flags a change vs the prior", () => {
    const row = buildCheck(
      vendor,
      "gst",
      { status: "CANCELLED", provider: "sandbox_quicko", raw: { sts: "Cancelled" } },
      "ACTIVE",
      now,
    );
    expect(row).toEqual({
      organization_id: "org1",
      vendor_id: "v1",
      check_type: "gst",
      status_value: "CANCELLED",
      provider: "sandbox_quicko",
      raw_response: { sts: "Cancelled" },
      is_change: true,
      checked_at: now,
    });
  });

  it("does not flag a change on the first-ever check", () => {
    const row = buildCheck(
      vendor,
      "msme_udyam",
      { status: "REGISTERED", provider: "mock", raw: {} },
      null,
      now,
    );
    expect(row.is_change).toBe(false);
  });
});
