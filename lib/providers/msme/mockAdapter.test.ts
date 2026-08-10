import { describe, it, expect } from "vitest";
import {
  createMockAdapter,
  MOCK_UDYAM_REGISTERED,
  MOCK_UDYAM_LAPSED,
  MOCK_UDYAM_NOT_MSME,
  MOCK_UDYAM_TIMEOUT,
} from "./mockAdapter";
import { expectMsmeCheckResultShape } from "./shapeAssertions";

describe("mock MSME adapter", () => {
  const adapter = createMockAdapter();

  it("returns REGISTERED with a registration date for the registered fixture", async () => {
    const result = await adapter.checkUdyam(MOCK_UDYAM_REGISTERED);
    expectMsmeCheckResultShape(result);
    expect(result.status).toBe("REGISTERED");
    expect(result.provider).toBe("mock");
    expect(result.error).toBeUndefined();
    // A registration date is present and parseable.
    expect(result.registrationDate).not.toBeNull();
    expect(Number.isNaN(Date.parse(result.registrationDate!))).toBe(false);
  });

  it("returns LAPSED for the lapsed fixture", async () => {
    const result = await adapter.checkUdyam(MOCK_UDYAM_LAPSED);
    expectMsmeCheckResultShape(result);
    expect(result.status).toBe("LAPSED");
    expect(result.registrationDate).not.toBeNull();
  });

  it("returns NOT_MSME with no registration date", async () => {
    const result = await adapter.checkUdyam(MOCK_UDYAM_NOT_MSME);
    expectMsmeCheckResultShape(result);
    expect(result.status).toBe("NOT_MSME");
    expect(result.registrationDate).toBeNull();
  });

  it("returns UNKNOWN + timeout error for the timeout fixture", async () => {
    const result = await adapter.checkUdyam(MOCK_UDYAM_TIMEOUT);
    expectMsmeCheckResultShape(result);
    expect(result.status).toBe("UNKNOWN");
    expect(result.error).toBe("timeout");
  });

  it("rejects a malformed Udyam number without throwing (no wasted call)", async () => {
    const result = await adapter.checkUdyam("not-a-udyam");
    expectMsmeCheckResultShape(result);
    expect(result.status).toBe("UNKNOWN");
    expect(result.error).toBe("invalid_udyam");
    expect(result.registrationDate).toBeNull();
  });

  it("normalizes case and whitespace", async () => {
    const result = await adapter.checkUdyam(
      `  ${MOCK_UDYAM_REGISTERED.toLowerCase()}  `,
    );
    expect(result.udyamNumber).toBe(MOCK_UDYAM_REGISTERED);
    expect(result.status).toBe("REGISTERED");
  });
});
