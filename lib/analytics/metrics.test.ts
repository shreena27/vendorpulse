import { describe, it, expect } from "vitest";
import {
  computeNorthStar,
  computeVendorsConnectedWithoutIt,
  computeStatusChangesDetected,
  computeAlertsActionedWithin24h,
  computeAlertPrecision,
  computeBankCertIssuesCaught,
  computeAuditTimeSaved,
} from "./metrics";

describe("computeNorthStar", () => {
  it("meets target with at least one hold or escalate in the window", () => {
    const result = computeNorthStar([
      { action: "hold" },
      { action: "reviewed" },
    ]);
    expect(result.value).toBe(1);
    expect(result.targetMet).toBe(true);
    expect(result.killSignalTriggered).toBe(false);
  });

  it("counts escalate as 'rerouted' toward the North Star", () => {
    const result = computeNorthStar([{ action: "escalate" }]);
    expect(result.value).toBe(1);
  });

  it("triggers the kill signal when alerts were actioned but never held or escalated", () => {
    const result = computeNorthStar([{ action: "reviewed" }, { action: "reviewed" }]);
    expect(result.value).toBe(0);
    expect(result.killSignalTriggered).toBe(true);
  });

  it("is insufficient data, not a kill signal, when nothing was actioned at all", () => {
    const result = computeNorthStar([]);
    expect(result.killSignalTriggered).toBe(false);
    expect(result.targetMet).toBe(false);
    expect(result.sampleSize).toBe(0);
  });
});

describe("computeVendorsConnectedWithoutIt", () => {
  it("meets target at 90%+ connected within 3 days of signup", () => {
    const result = computeVendorsConnectedWithoutIt({
      vendorCreatedAts: ["2026-01-01", "2026-01-02", "2026-01-02"],
      orgCreatedAt: "2026-01-01",
      now: new Date("2026-01-20"),
    });
    expect(result.value).toBe(100);
    expect(result.targetMet).toBe(true);
  });

  it("triggers the kill signal below 50% once 2 weeks have passed", () => {
    const result = computeVendorsConnectedWithoutIt({
      vendorCreatedAts: ["2026-01-01", "2026-01-10", "2026-01-10", "2026-01-10"],
      orgCreatedAt: "2026-01-01",
      now: new Date("2026-01-20"),
    });
    expect(result.value).toBe(25);
    expect(result.killSignalTriggered).toBe(true);
  });

  it("withholds the kill-signal verdict before 2 weeks have passed", () => {
    const result = computeVendorsConnectedWithoutIt({
      vendorCreatedAts: ["2026-01-10"],
      orgCreatedAt: "2026-01-01",
      now: new Date("2026-01-05"),
    });
    expect(result.killSignalTriggered).toBe(false);
    expect(result.notes).toMatch(/insufficient/i);
  });
});

describe("computeStatusChangesDetected", () => {
  it("meets target at 1+ per 100 vendors", () => {
    const result = computeStatusChangesDetected({ changeCount: 2, vendorCount: 150 });
    expect(result.value).toBeCloseTo(1.33, 2);
    expect(result.targetMet).toBe(true);
  });

  it("triggers the kill signal at zero changes with vendors present", () => {
    const result = computeStatusChangesDetected({ changeCount: 0, vendorCount: 50 });
    expect(result.killSignalTriggered).toBe(true);
  });
});

describe("computeAlertsActionedWithin24h", () => {
  it("meets target at 80%+ within 24h", () => {
    const result = computeAlertsActionedWithin24h([
      { actionedWithin24h: true, actionedWithin48h: true },
      { actionedWithin24h: true, actionedWithin48h: true },
      { actionedWithin24h: true, actionedWithin48h: true },
      { actionedWithin24h: false, actionedWithin48h: true },
    ]);
    expect(result.value).toBe(75);
    expect(result.targetMet).toBe(false); // 75 < 80
  });

  it("triggers the kill signal below 30% within 48h", () => {
    const result = computeAlertsActionedWithin24h([
      { actionedWithin24h: false, actionedWithin48h: false },
      { actionedWithin24h: false, actionedWithin48h: false },
      { actionedWithin24h: false, actionedWithin48h: false },
      { actionedWithin24h: false, actionedWithin48h: true },
    ]);
    expect(result.killSignalTriggered).toBe(true);
  });
});

describe("computeAlertPrecision", () => {
  it("counts hold/escalate as confirmed genuine, not reviewed alone", () => {
    const result = computeAlertPrecision(["hold", "escalate", "reviewed", "hold"]);
    expect(result.value).toBe(75);
  });

  it("triggers the kill signal below 60%", () => {
    const result = computeAlertPrecision(["reviewed", "reviewed", "reviewed", "hold"]);
    expect(result.killSignalTriggered).toBe(true);
  });
});

describe("computeBankCertIssuesCaught", () => {
  it("meets target with at least one issue caught, ever", () => {
    expect(computeBankCertIssuesCaught(1).targetMet).toBe(true);
    expect(computeBankCertIssuesCaught(0).targetMet).toBe(false);
  });
});

describe("computeAuditTimeSaved", () => {
  it("meets target at an average 30%+ reduction", () => {
    const result = computeAuditTimeSaved([40, 25]);
    expect(result.value).toBeCloseTo(32.5, 1);
    expect(result.targetMet).toBe(true);
  });

  it("triggers the kill signal when reports show no measurable reduction", () => {
    const result = computeAuditTimeSaved([0, -5]);
    expect(result.killSignalTriggered).toBe(true);
  });

  it("is insufficient data with no reports yet", () => {
    const result = computeAuditTimeSaved([]);
    expect(result.sampleSize).toBe(0);
    expect(result.targetMet).toBe(false);
    expect(result.killSignalTriggered).toBe(false);
  });
});
