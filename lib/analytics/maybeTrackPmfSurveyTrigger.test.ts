import { describe, it, expect } from "vitest";
import { shouldTriggerPmfSurvey } from "./maybeTrackPmfSurveyTrigger";

describe("shouldTriggerPmfSurvey", () => {
  it("is false before the 3rd actioned alert", () => {
    expect(shouldTriggerPmfSurvey({ actionedAlertCount: 2, daysSinceSignup: 20 })).toBe(false);
  });

  it("is true exactly at the 3rd actioned alert, once 14 days have passed", () => {
    expect(shouldTriggerPmfSurvey({ actionedAlertCount: 3, daysSinceSignup: 14 })).toBe(true);
  });

  it("is false at the 3rd actioned alert if fewer than 14 days have passed", () => {
    expect(shouldTriggerPmfSurvey({ actionedAlertCount: 3, daysSinceSignup: 5 })).toBe(false);
  });

  it("is false again past the 3rd — this only fires once, at the crossing point", () => {
    expect(shouldTriggerPmfSurvey({ actionedAlertCount: 4, daysSinceSignup: 20 })).toBe(false);
  });
});
