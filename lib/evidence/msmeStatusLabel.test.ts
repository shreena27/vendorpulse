import { describe, it, expect } from "vitest";
import { formatMsmeStatusLabel, formatUdyamNumberField } from "./msmeStatusLabel";

describe("formatMsmeStatusLabel", () => {
  it("labels not_applicable as Not MSME-registered — no Udyam number, never MSME-checkable", () => {
    expect(formatMsmeStatusLabel({ kind: "not_applicable" })).toBe("Not MSME-registered");
  });

  it("labels no_record as No verification record — has a Udyam number, but evidence is missing as of the due date", () => {
    expect(formatMsmeStatusLabel({ kind: "no_record" })).toBe("No verification record");
  });

  it("labels each known checked statusValue", () => {
    const at = "2026-01-01T00:00:00.000Z";
    expect(formatMsmeStatusLabel({ kind: "checked", statusValue: "REGISTERED", checkedAt: at })).toBe("Registered");
    expect(formatMsmeStatusLabel({ kind: "checked", statusValue: "LAPSED", checkedAt: at })).toBe("Lapsed");
    expect(formatMsmeStatusLabel({ kind: "checked", statusValue: "NOT_MSME", checkedAt: at })).toBe("Not MSME");
    expect(formatMsmeStatusLabel({ kind: "checked", statusValue: "UNKNOWN", checkedAt: at })).toBe("Unknown");
  });

  it("falls back to the raw statusValue for an unrecognized value, rather than throwing or blanking", () => {
    const at = "2026-01-01T00:00:00.000Z";
    expect(formatMsmeStatusLabel({ kind: "checked", statusValue: "SOMETHING_NEW", checkedAt: at })).toBe(
      "SOMETHING_NEW",
    );
  });
});

describe("formatUdyamNumberField", () => {
  it("passes through a real Udyam number unchanged", () => {
    expect(formatUdyamNumberField("UDYAM-MH-01-0000001")).toBe("UDYAM-MH-01-0000001");
  });

  it("never leaves the column blank — labels a null Udyam number as Not registered", () => {
    expect(formatUdyamNumberField(null)).toBe("Not registered");
  });
});
