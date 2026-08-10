import { describe, it, expect } from "vitest";
import { matchNames } from "./nameMatch";

describe("matchNames", () => {
  it("returns exact for identical names", () => {
    expect(matchNames("Acme Traders", "Acme Traders")).toBe("exact");
  });

  it("returns exact ignoring case, punctuation, and spacing", () => {
    expect(matchNames("Acme Traders Pvt. Ltd.", "ACME   TRADERS PVT LTD")).toBe(
      "exact",
    );
  });

  it("returns partial when the names share a significant token", () => {
    expect(matchNames("Acme Traders", "Acme Enterprises")).toBe("partial");
  });

  it("returns none when the names share no significant token", () => {
    expect(matchNames("Acme Traders", "Zenith Corp")).toBe("none");
  });

  it("returns none when the only shared tokens are short/common words", () => {
    expect(matchNames("A B Traders", "A B Enterprises")).toBe("none");
  });
});
