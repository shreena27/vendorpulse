import { describe, it, expect } from "vitest";
import { formatIndianCurrency, describeStatusChange, buildNudgeMessage } from "./nudgeCopy";

describe("formatIndianCurrency", () => {
  it("formats amounts under 1 lakh with plain en-IN grouping", () => {
    expect(formatIndianCurrency(45000)).toBe("₹45,000");
  });

  it("formats amounts at or above 1 lakh in L notation", () => {
    expect(formatIndianCurrency(410000)).toBe("₹4.1L");
    expect(formatIndianCurrency(100000)).toBe("₹1.0L");
  });

  it("formats amounts at or above 1 crore in Cr notation", () => {
    expect(formatIndianCurrency(12000000)).toBe("₹1.2Cr");
    expect(formatIndianCurrency(10000000)).toBe("₹1.0Cr");
  });

  it("formats zero as plain rupees", () => {
    expect(formatIndianCurrency(0)).toBe("₹0");
  });
});

describe("describeStatusChange", () => {
  it("phrases known GST statuses naturally", () => {
    expect(describeStatusChange("gst_change", "ACTIVE")).toBe("became active");
    expect(describeStatusChange("gst_change", "CANCELLED")).toBe("was cancelled");
    expect(describeStatusChange("gst_change", "INACTIVE")).toBe("went inactive");
  });

  it("phrases known MSME statuses naturally", () => {
    expect(describeStatusChange("msme_change", "REGISTERED")).toBe("became registered");
    expect(describeStatusChange("msme_change", "LAPSED")).toBe("lapsed");
    expect(describeStatusChange("msme_change", "NOT_MSME")).toBe(
      "is no longer classified as MSME",
    );
  });

  it("falls back to a generic phrase for an unmapped status value", () => {
    expect(describeStatusChange("gst_change", "SOMETHING_NEW")).toBe(
      "changed to SOMETHING_NEW",
    );
  });
});

describe("buildNudgeMessage", () => {
  it("matches the PRD example for a plural payment case", () => {
    const msg = buildNudgeMessage({
      vendorName: "Vendor X",
      triggerType: "gst_change",
      statusValue: "INACTIVE",
      paymentCount: 2,
      paymentAmount: 410000,
    });
    expect(msg.changeLine).toBe("Vendor X's GST registration just went inactive.");
    expect(msg.impactLine).toBe("2 pending payments total ₹4.1L.");
    expect(msg.question).toBe("Hold them?");
  });

  it("uses singular phrasing for exactly one pending payment", () => {
    const msg = buildNudgeMessage({
      vendorName: "Vendor Y",
      triggerType: "msme_change",
      statusValue: "LAPSED",
      paymentCount: 1,
      paymentAmount: 45000,
    });
    expect(msg.impactLine).toBe("1 pending payment totals ₹45,000.");
    expect(msg.question).toBe("Hold it?");
  });

  it("handles zero pending payments without a nonsensical hold question", () => {
    const msg = buildNudgeMessage({
      vendorName: "Vendor Z",
      triggerType: "gst_change",
      statusValue: "CANCELLED",
      paymentCount: 0,
      paymentAmount: 0,
    });
    expect(msg.impactLine).toBe("No pending payments remain for this vendor.");
    expect(msg.question).toBe("Review?");
  });

  it("labels the registration type per trigger_type", () => {
    const gst = buildNudgeMessage({
      vendorName: "V",
      triggerType: "gst_change",
      statusValue: "ACTIVE",
      paymentCount: 1,
      paymentAmount: 1000,
    });
    const msme = buildNudgeMessage({
      vendorName: "V",
      triggerType: "msme_change",
      statusValue: "REGISTERED",
      paymentCount: 1,
      paymentAmount: 1000,
    });
    expect(gst.changeLine).toContain("GST registration");
    expect(msme.changeLine).toContain("MSME registration");
  });

  // The critical wording constraint: the system never claims to have taken
  // the action itself. It asks; the finance head decides.
  it("never implies the system already took the action — the question is always a question", () => {
    const cases = [
      { paymentCount: 0, paymentAmount: 0 },
      { paymentCount: 1, paymentAmount: 45000 },
      { paymentCount: 3, paymentAmount: 900000 },
    ];
    for (const c of cases) {
      const msg = buildNudgeMessage({
        vendorName: "Any Vendor",
        triggerType: "gst_change",
        statusValue: "CANCELLED",
        ...c,
      });
      expect(msg.question).toMatch(/\?$/);
      const fullText = `${msg.changeLine} ${msg.impactLine} ${msg.question}`;
      expect(fullText).not.toMatch(/automatically/i);
      expect(fullText).not.toMatch(/has been held/i);
      expect(fullText).not.toMatch(/system held/i);
      expect(fullText).not.toMatch(/we (?:have )?held/i);
    }
  });
});
