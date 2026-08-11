import { describe, it, expect } from "vitest";
import { formatMsmeStatusLabel } from "./msmeStatusLabel";

describe("formatMsmeStatusLabel", () => {
  it("labels not_applicable", () => {
    expect(formatMsmeStatusLabel({ kind: "not_applicable" })).toBe("Not applicable");
  });

  it("labels no_record", () => {
    expect(formatMsmeStatusLabel({ kind: "no_record" })).toBe("No record");
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
