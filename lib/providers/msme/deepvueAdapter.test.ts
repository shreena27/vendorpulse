import { describe, it, expect } from "vitest";
import { createDeepvueAdapter } from "./deepvueAdapter";
import { MOCK_UDYAM_REGISTERED } from "./mockAdapter";

describe("deepvue MSME adapter (stub)", () => {
  it("constructs but fails loudly when used, never silently", async () => {
    const adapter = createDeepvueAdapter();
    expect(adapter.name).toBe("deepvue");
    // Even a well-formed Udyam number must not return a fabricated result.
    await expect(adapter.checkUdyam(MOCK_UDYAM_REGISTERED)).rejects.toThrow(
      /not configured/i,
    );
  });
});
