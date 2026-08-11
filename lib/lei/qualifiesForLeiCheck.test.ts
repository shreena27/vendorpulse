import { describe, it, expect } from "vitest";
import { LEI_THRESHOLD, qualifiesForLeiCheck } from "./qualifiesForLeiCheck";

describe("qualifiesForLeiCheck", () => {
  it("is exactly ₹50 crore", () => {
    expect(LEI_THRESHOLD).toBe(500_000_000);
  });

  it("does not qualify just under the threshold (₹49.99cr)", () => {
    expect(qualifiesForLeiCheck(499_900_000, "rtgs")).toBe(false);
  });

  it("qualifies exactly at the threshold (₹50.00cr)", () => {
    expect(qualifiesForLeiCheck(500_000_000, "rtgs")).toBe(true);
  });

  it("qualifies just over the threshold (₹50.01cr)", () => {
    expect(qualifiesForLeiCheck(500_100_000, "neft")).toBe(true);
  });

  it("qualifies for rtgs at threshold", () => {
    expect(qualifiesForLeiCheck(500_000_000, "rtgs")).toBe(true);
  });

  it("qualifies for neft at threshold", () => {
    expect(qualifiesForLeiCheck(500_000_000, "neft")).toBe(true);
  });

  it("never qualifies for other, however large the amount", () => {
    expect(qualifiesForLeiCheck(1_000_000_000, "other")).toBe(false);
  });
});
