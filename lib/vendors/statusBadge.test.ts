import { describe, it, expect } from "vitest";
import { deriveStatusBadge, isAttentionTone } from "./statusBadge";

describe("deriveStatusBadge — GST/MSME identifier + check logic", () => {
  it("is N/A when the vendor has no identifier", () => {
    const b = deriveStatusBadge({
      kind: "gst",
      hasIdentifier: false,
      hasCheck: false,
      currentStatus: "unknown",
    });
    expect(b).toEqual({ label: "N/A", tone: "neutral" });
  });

  it("is Pending when there is an identifier but no check yet", () => {
    const b = deriveStatusBadge({
      kind: "gst",
      hasIdentifier: true,
      hasCheck: false,
      currentStatus: "unknown",
    });
    expect(b).toEqual({ label: "Pending", tone: "blue" });
  });

  it("distinguishes Pending (no check) from Unknown (checked, no answer)", () => {
    const pending = deriveStatusBadge({
      kind: "gst",
      hasIdentifier: true,
      hasCheck: false,
      currentStatus: "unknown",
    });
    const unknown = deriveStatusBadge({
      kind: "gst",
      hasIdentifier: true,
      hasCheck: true,
      currentStatus: "unknown",
    });
    expect(pending.label).toBe("Pending");
    expect(unknown.label).toBe("Unknown");
  });

  it("maps checked GST statuses to labels + tones", () => {
    const checked = (currentStatus: string) =>
      deriveStatusBadge({ kind: "gst", hasIdentifier: true, hasCheck: true, currentStatus });
    expect(checked("active")).toEqual({ label: "Active", tone: "green" });
    expect(checked("cancelled")).toEqual({ label: "Cancelled", tone: "red" });
    expect(checked("inactive")).toEqual({ label: "Inactive", tone: "amber" });
  });

  it("maps checked MSME statuses to labels + tones", () => {
    const checked = (currentStatus: string) =>
      deriveStatusBadge({ kind: "msme", hasIdentifier: true, hasCheck: true, currentStatus });
    expect(checked("registered")).toEqual({ label: "Registered", tone: "green" });
    expect(checked("lapsed")).toEqual({ label: "Lapsed", tone: "amber" });
    expect(checked("not_msme")).toEqual({ label: "Not MSME", tone: "neutral" });
  });
});

describe("deriveStatusBadge — bank always reads its stored status", () => {
  it("ignores identifier/check and maps the bank status", () => {
    const b = deriveStatusBadge({
      kind: "bank",
      hasIdentifier: true,
      hasCheck: false,
      currentStatus: "unverified",
    });
    expect(b).toEqual({ label: "Unverified", tone: "gray" });
  });

  it("maps manual_review to an attention-worthy amber badge, never Verified (Chunk 2.1)", () => {
    const b = deriveStatusBadge({
      kind: "bank",
      hasIdentifier: true,
      hasCheck: false,
      currentStatus: "manual_review",
    });
    expect(b).toEqual({ label: "Manual review", tone: "amber" });
    expect(b.label).not.toBe("Verified");
  });
});

describe("isAttentionTone", () => {
  it("flags red and amber, not green/blue/gray/neutral", () => {
    expect(isAttentionTone("red")).toBe(true);
    expect(isAttentionTone("amber")).toBe(true);
    expect(isAttentionTone("green")).toBe(false);
    expect(isAttentionTone("blue")).toBe(false);
    expect(isAttentionTone("gray")).toBe(false);
    expect(isAttentionTone("neutral")).toBe(false);
  });
});
