import { describe, it, expect } from "vitest";
import { formatLeiStatusLabel } from "./leiStatusLabel";

describe("formatLeiStatusLabel", () => {
  it("labels not_applicable — this payment doesn't qualify for an LEI check at all", () => {
    expect(formatLeiStatusLabel({ kind: "not_applicable" })).toBe("Not applicable");
  });

  it("labels no_record — qualifies, but evidence is missing as of the due date", () => {
    expect(formatLeiStatusLabel({ kind: "no_record" })).toBe("No verification record");
  });

  it("labels each known checked statusValue", () => {
    const at = "2026-01-01T00:00:00.000Z";
    expect(formatLeiStatusLabel({ kind: "checked", statusValue: "issued", checkedAt: at })).toBe("Valid");
    expect(formatLeiStatusLabel({ kind: "checked", statusValue: "lapsed", checkedAt: at })).toBe("Lapsed");
    expect(formatLeiStatusLabel({ kind: "checked", statusValue: "retired", checkedAt: at })).toBe("Retired");
    expect(formatLeiStatusLabel({ kind: "checked", statusValue: "not_on_record", checkedAt: at })).toBe(
      "No LEI on record",
    );
  });

  it("falls back to the raw statusValue for an unrecognized value, rather than throwing or blanking", () => {
    const at = "2026-01-01T00:00:00.000Z";
    expect(formatLeiStatusLabel({ kind: "checked", statusValue: "SOMETHING_NEW", checkedAt: at })).toBe(
      "SOMETHING_NEW",
    );
  });
});
